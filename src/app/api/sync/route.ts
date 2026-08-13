import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/services/aggregator/autoSync";

export const maxDuration = 300; // Allow API route to run up to 5 minutes on Vercel Pro/Enterprise or custom server

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("x-sync-secret");
    const secretKey = process.env.SYNC_SECRET_KEY;

    if (!secretKey || authHeader !== secretKey) {
      return NextResponse.json({ error: "Unauthorized. Invalid sync secret key." }, { status: 401 });
    }

    console.log("Triggering EV charger database synchronization...");
    const result = await runSync();

    return NextResponse.json({ success: !result.error, result });
  } catch (error: any) {
    console.error("API error during manual synchronization:", error);
    return NextResponse.json({ error: "Internal sync error", message: error.message }, { status: 500 });
  }
}
