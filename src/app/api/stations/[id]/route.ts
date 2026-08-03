import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: stationId } = await params;

    if (!stationId) {
      return NextResponse.json({ error: "Missing station ID" }, { status: 400 });
    }

    const station = await db.station.findUnique({
      where: { id: stationId },
      include: { connectors: true }
    });

    if (!station) {
      return NextResponse.json({ error: "Station not found" }, { status: 404 });
    }

    return NextResponse.json(station);
  } catch (error) {
    console.error("API error fetching station details:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
