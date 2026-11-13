import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { route } from "@/lib/v1/http";
import { version } from "../../../../../package.json";

const noStore = { "Cache-Control": "no-store" };

// docs/api-v1.md 3.7. Failure detail (host, driver message) is never returned.
async function dbUp(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 2000); }),
    ]);
    return true;
  } catch (err) {
    console.error("[v1] health db check failed", err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const GET = route({ auth: "none" }, async () => {
  const up = await dbUp();
  return NextResponse.json(
    up ? { status: "ok", db: "ok", version } : { status: "degraded", db: "down", version },
    { status: up ? 200 : 503, headers: noStore },
  );
});
