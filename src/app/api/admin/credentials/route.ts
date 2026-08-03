import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { CredentialStatus } from "@prisma/client";

// Guard middleware to ensure only Admin users can invoke these API endpoints
async function verifyAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function GET(req: NextRequest) {
  try {
    await verifyAdmin();
    
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

    // Mask sensitive auth tokens before sending to client
    const sanitized = credentials.map(c => ({
      id: c.id,
      cpoName: c.cpoName,
      status: c.status,
      updatedAt: c.updatedAt,
      expiresAt: c.expiresAt,
      hasToken: !!c.authToken,
      headers: c.headers,
      cookies: c.cookies,
      errorLogs: c.errorLogs
    }));

    return NextResponse.json(sanitized);
  } catch (error: any) {
    if (error.message === "Unauthorized") {
      return NextResponse.json({ error: "Access denied. Admin role required." }, { status: 403 });
    }
    console.error("Admin API error fetching credentials:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await verifyAdmin();
    
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
  } catch (error: any) {
    if (error.message === "Unauthorized") {
      return NextResponse.json({ error: "Access denied. Admin role required." }, { status: 403 });
    }
    console.error("Admin API error configuring credentials:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
