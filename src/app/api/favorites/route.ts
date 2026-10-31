import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";

// GET: List user's favorite station IDs
export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const favorites = await db.favorite.findMany({
      where: { userId: auth.user.id },
      select: { stationId: true },
    });

    return NextResponse.json({
      favoriteIds: favorites.map((f) => f.stationId),
    });
  } catch (error) {
    console.error("Favorites API error fetching favorites:", error);
    return NextResponse.json(
      { error: "Failed to fetch favorites" },
      { status: 500 }
    );
  }
}

// POST: Toggle favorite for a station
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const { stationId } = body;

    if (!stationId) {
      return NextResponse.json(
        { error: "stationId is required" },
        { status: 400 }
      );
    }

    // Check if already favorited
    const existing = await db.favorite.findUnique({
      where: {
        userId_stationId: {
          userId: auth.user.id,
          stationId,
        },
      },
    });

    if (existing) {
      // Remove favorite
      await db.favorite.delete({ where: { id: existing.id } });
      return NextResponse.json({ action: "removed", stationId });
    } else {
      // Add favorite
      await db.favorite.create({
        data: {
          userId: auth.user.id,
          stationId,
        },
      });
      return NextResponse.json({ action: "added", stationId });
    }
  } catch (error) {
    console.error("Favorites API error toggling favorite:", error);
    return NextResponse.json(
      { error: "Failed to toggle favorite" },
      { status: 500 }
    );
  }
}
