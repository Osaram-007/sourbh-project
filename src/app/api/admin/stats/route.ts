import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Total stations
    const totalStations = await db.station.count();

    // Per-source breakdown
    const sourceBreakdown = await db.station.groupBy({
      by: ["source"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });

    // Total connectors
    const totalConnectors = await db.connector.count();

    // Connector type breakdown
    const connectorBreakdown = await db.connector.groupBy({
      by: ["type"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });

    // Station status breakdown
    const statusBreakdown = await db.station.groupBy({
      by: ["status"],
      _count: { id: true },
    });

    // Total users
    const totalUsers = await db.user.count();

    // Total reviews
    const totalReviews = await db.review.count();

    return NextResponse.json({
      totalStations,
      totalConnectors,
      totalUsers,
      totalReviews,
      sourceBreakdown: sourceBreakdown.map((s) => ({
        source: s.source,
        count: s._count.id,
      })),
      connectorBreakdown: connectorBreakdown.map((c) => ({
        type: c.type,
        count: c._count.id,
      })),
      statusBreakdown: statusBreakdown.map((s) => ({
        status: s.status,
        count: s._count.id,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch stats", message: error.message },
      { status: 500 }
    );
  }
}
