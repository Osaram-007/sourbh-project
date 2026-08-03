import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Redis as UpstashRedis } from "@upstash/redis";
import IORedis from "ioredis";

// Define a unified interface for our cache client
interface CacheClient {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any, options?: { ex?: number }) => Promise<any>;
}

let cache: CacheClient | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    const upstash = new UpstashRedis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    cache = {
      get: async (key) => upstash.get(key),
      set: async (key, val, opts) => {
        if (opts?.ex !== undefined) {
          return upstash.set(key, val, { ex: opts.ex });
        }
        return upstash.set(key, val);
      }
    };
  } catch (e) {
    console.warn("Failed to initialize Upstash Redis. Caching is disabled.");
  }
} else if (process.env.REDIS_URL && (process.env.REDIS_URL.startsWith("redis://") || process.env.REDIS_URL.startsWith("rediss://"))) {
  try {
    const localRedis = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1 // Don't hang the NextJS build or server routes on reconnection loops
    });
    localRedis.on("error", (err) => {
      // Gracefully log connection issues without uncaught process exceptions
    });
    cache = {
      get: async (key) => {
        try {
          const val = await localRedis.get(key);
          return val ? JSON.parse(val) : null;
        } catch (e) {
          return null;
        }
      },
      set: async (key, val, opts) => {
        try {
          const strVal = JSON.stringify(val);
          if (opts?.ex) {
            return localRedis.set(key, strVal, "EX", opts.ex);
          }
          return localRedis.set(key, strVal);
        } catch (e) {
          return null;
        }
      }
    };
  } catch (e) {
    console.warn("Failed to initialize local ioredis client. Caching is disabled.");
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const north = parseFloat(searchParams.get("north") || "");
    const south = parseFloat(searchParams.get("south") || "");
    const east = parseFloat(searchParams.get("east") || "");
    const west = parseFloat(searchParams.get("west") || "");

    if (isNaN(north) || isNaN(south) || isNaN(east) || isNaN(west)) {
      return NextResponse.json({ error: "Missing or invalid bounding box parameters" }, { status: 400 });
    }

    const providers = searchParams.get("providers")?.split(",").filter(Boolean) || [];
    const connectors = searchParams.get("connectors")?.split(",").filter(Boolean) || [];
    const speeds = searchParams.get("speeds")?.split(",").filter(Boolean) || [];
    const status = searchParams.get("status") || null;

    // 1. Bounding box rounding for caching
    const roundedN = north.toFixed(2);
    const roundedS = south.toFixed(2);
    const roundedE = east.toFixed(2);
    const roundedW = west.toFixed(2);

    const filterHash = [
      `p:${providers.sort().join(",")}`,
      `c:${connectors.sort().join(",")}`,
      `s:${speeds.sort().join(",")}`,
      `st:${status || "any"}`
    ].join("|");

    const cacheKey = `stations:box:N${roundedN}:S${roundedS}:E${roundedE}:W${roundedW}:f:${filterHash}`;

    // 2. Try Cache-Aside
    if (cache) {
      try {
        const cachedData = await cache.get(cacheKey);
        if (cachedData) {
          return NextResponse.json(cachedData);
        }
      } catch (err) {
        console.warn("Redis cache read failed, falling back to database:", err);
      }
    }

    // 3. Database Query
    const result = await db.station.findMany({
      where: {
        latitude: { gte: south, lte: north },
        longitude: { gte: west, lte: east },
        ...(providers.length > 0 ? { source: { in: providers } } : {}),
        ...(status ? { status: status as any } : {}),
        ...(connectors.length > 0 ? { connectors: { some: { type: { in: connectors as any } } } } : {}),
        ...(speeds.length > 0 ? { connectors: { some: { currentType: { in: speeds as any } } } } : {})
      },
      include: {
        connectors: true
      },
      take: 300
    });

    // 4. Cache-Aside Write-Back
    if (cache) {
      try {
        await cache.set(cacheKey, result, { ex: 15 });
      } catch (err) {
        console.warn("Redis cache write failed:", err);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("API error fetching viewport stations:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
