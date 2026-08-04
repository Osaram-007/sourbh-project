import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");

    if (!query || query.trim().length < 2) {
      return NextResponse.json([]);
    }

    const results = await db.station.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { city: { contains: query, mode: "insensitive" } },
          { address: { contains: query, mode: "insensitive" } },
          { operator: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
        operator: true,
        source: true,
        status: true,
        latitude: true,
        longitude: true,
      },
      take: 10,
      orderBy: { name: "asc" },
    });

    return NextResponse.json(results);
  } catch (error: any) {
    return NextResponse.json(
      { error: "Search failed", message: error.message },
      { status: 500 }
    );
  }
}
