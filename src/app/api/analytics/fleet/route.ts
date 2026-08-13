import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
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
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

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
