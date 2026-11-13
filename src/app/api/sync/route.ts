import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/services/aggregator/autoSync";
import { publicSyncResult } from "@/app/api/admin/syncView";

export const maxDuration = 300; // Allow API route to run up to 5 minutes on Vercel Pro/Enterprise or custom server

// Constant-time compare. Hashing first gives timingSafeEqual equal-length inputs, so length does not leak.
const sha256 = (s: string) => createHash("sha256").update(s).digest();

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("x-sync-secret");
    const secretKey = process.env.SYNC_SECRET_KEY;

    if (!secretKey || !authHeader || !timingSafeEqual(sha256(authHeader), sha256(secretKey))) {
      return NextResponse.json({ error: "Unauthorized. Invalid sync secret key." }, { status: 401 });
    }

    console.log("Triggering EV charger database synchronization...");
    const result = await runSync();

    return NextResponse.json({ success: !result.error, result: publicSyncResult(result) });
  } catch (error) {
    console.error("API error during manual synchronization:", error);
    return NextResponse.json({ error: "Internal sync error" }, { status: 500 });
  }
}
