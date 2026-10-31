import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { getFleetOverview } from "@/services/analytics/behaviorAnalysis";

/**
 * GET /api/analytics/fleet
 *
 * Returns fleet-wide charger behavior overview. Admin-only: this does a
 * full scan over every station's snapshots and is only used by the admin
 * analytics page.
 * Query params:
 *   - range: "24h" | "7d" | "30d" (default: "7d")
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

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
