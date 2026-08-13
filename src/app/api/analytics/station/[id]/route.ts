import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getStationBehavior, getStationReliability } from "@/services/analytics/behaviorAnalysis";

/**
 * GET /api/analytics/station/[id]
 *
 * Returns per-charger behavior analysis for the given station.
 * Query params:
 *   - range: "24h" | "7d" | "30d" (default: "7d")
 *   - quick: "true" to return only reliability score (for badge)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const range = searchParams.get("range") || "7d";
    const quick = searchParams.get("quick") === "true";

    if (!id) {
      return NextResponse.json(
        { error: "Station ID is required" },
        { status: 400 }
      );
    }

    // Quick mode: just return reliability score for badge display
    if (quick) {
      const reliability = await getStationReliability(id);
      if (!reliability) {
        return NextResponse.json(
          { error: "No analytics data available for this station" },
          { status: 404 }
        );
      }
      return NextResponse.json(reliability);
    }

    // Full behavior analysis is admin-only (heavier query, only used by the admin analytics page)
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const behavior = await getStationBehavior(id, range);
    if (!behavior) {
      return NextResponse.json(
        { error: "Station not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(behavior);
  } catch (error) {
    console.error("Analytics station API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
