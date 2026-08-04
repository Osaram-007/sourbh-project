import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: Fetch reviews for a station
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const stationId = searchParams.get("stationId");

    if (!stationId) {
      return NextResponse.json(
        { error: "stationId query parameter is required" },
        { status: 400 }
      );
    }

    const reviews = await db.review.findMany({
      where: { stationId },
      include: {
        user: {
          select: { name: true, image: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    // Calculate average rating
    const totalRatings = reviews.length;
    const averageRating =
      totalRatings > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalRatings
        : 0;

    return NextResponse.json({
      reviews,
      averageRating: Math.round(averageRating * 10) / 10,
      totalRatings,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch reviews", message: error.message },
      { status: 500 }
    );
  }
}

// POST: Submit a review
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { stationId, rating, comment } = body;

    if (!stationId || !rating || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "stationId and rating (1-5) are required" },
        { status: 400 }
      );
    }

    const review = await db.review.create({
      data: {
        userId: session.user.id,
        stationId,
        rating: Math.round(rating),
        comment: comment || null,
      },
      include: {
        user: {
          select: { name: true, image: true },
        },
      },
    });

    return NextResponse.json({ success: true, review });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to submit review", message: error.message },
      { status: 500 }
    );
  }
}
