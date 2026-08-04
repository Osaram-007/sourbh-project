import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: List user's favorite station IDs
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const favorites = await db.favorite.findMany({
      where: { userId: session.user.id },
      select: { stationId: true },
    });

    return NextResponse.json({
      favoriteIds: favorites.map((f) => f.stationId),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch favorites", message: error.message },
      { status: 500 }
    );
  }
}

// POST: Toggle favorite for a station
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
          userId: session.user.id,
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
          userId: session.user.id,
          stationId,
        },
      });
      return NextResponse.json({ action: "added", stationId });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to toggle favorite", message: error.message },
      { status: 500 }
    );
  }
}
