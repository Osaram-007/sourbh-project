import { NextRequest, NextResponse } from "next/server";
import { getFleetOverview } from "@/services/analytics/behaviorAnalysis";

/**
 * GET /api/analytics/fleet
 *
 * Returns fleet-wide charger behavior overview.
 * Query params:
 *   - range: "24h" | "7d" | "30d" (default: "7d")
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const range = searchParams.get("range") || "7d";

    const overview = await getFleetOverview(range);
    return NextResponse.json(overview);
  } catch (error) {
    console.error("Fleet analytics API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
