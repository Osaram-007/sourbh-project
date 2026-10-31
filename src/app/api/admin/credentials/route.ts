import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { CredentialStatus } from "@prisma/client";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    // Fetch CPO credentials and include recent error logs
    const credentials = await db.cpoCredential.findMany({
      include: {
        errorLogs: {
          orderBy: { timestamp: "desc" },
          take: 5
        }
      },
      orderBy: { cpoName: "asc" }
    });

    // Masked view only: never send tokens, headers or cookies back to the client
    const sanitized = credentials.map(c => ({
      id: c.id,
      cpoName: c.cpoName,
      status: c.status,
      updatedAt: c.updatedAt,
      expiresAt: c.expiresAt,
      hasToken: !!c.authToken,
      errorLogs: c.errorLogs
    }));

    return NextResponse.json(sanitized);
  } catch (error) {
    console.error("Admin API error fetching credentials:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const { cpoName, authToken, refreshToken, headers, cookies, expiresAt } = body;

    if (!cpoName || !authToken) {
      return NextResponse.json({ error: "cpoName and authToken are required" }, { status: 400 });
    }

    const cpoCred = await db.cpoCredential.upsert({
      where: { cpoName },
      create: {
        cpoName,
        authToken,
        refreshToken: refreshToken || null,
        headers: headers || {},
        cookies: cookies || {},
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        status: CredentialStatus.ACTIVE
      },
      update: {
        authToken,
        refreshToken: refreshToken || null,
        headers: headers || {},
        cookies: cookies || {},
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        status: CredentialStatus.ACTIVE,
        updatedAt: new Date()
      }
    });

    return NextResponse.json({
      success: true,
      message: `Credentials for ${cpoName} configured successfully.`,
      id: cpoCred.id
    });
  } catch (error) {
    console.error("Admin API error configuring credentials:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
