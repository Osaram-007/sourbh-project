import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { CredentialStatus } from "@prisma/client";

// Stored CrawlerLog.message text can embed secrets (fetch puts a bad header value into its error
// text), so GET never reads it. Every row is a failure; the text comes from the integer statusCode
// alone and the details stay in the server logs.
const failureText = (statusCode: number) =>
  statusCode === 401 || statusCode === 403 ? "Token rejected, see server logs" : "Crawler failed, see server logs";

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

    // Masked view only: explicit fields, never tokens, headers, cookies or stored log text
    const sanitized = credentials.map(c => ({
      id: c.id,
      cpoName: c.cpoName,
      status: c.status,
      updatedAt: c.updatedAt,
      expiresAt: c.expiresAt,
      hasToken: !!c.authToken,
      errorLogs: c.errorLogs.map(l => ({
        id: l.id,
        statusCode: l.statusCode,
        message: failureText(l.statusCode),
        timestamp: l.timestamp
      }))
    }));

    return NextResponse.json(sanitized);
  } catch (error) {
    console.error("Admin API error fetching credentials:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

// CR, LF, NUL and other control characters are what make fetch reject a header value (with the
// value in the error text) and Postgres reject text.
const CONTROL = /[\u0000-\u001f\u007f]/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// A string fetch can send as a header value: no control characters, Latin-1 only.
const sendable = (v: unknown): v is string =>
  typeof v === "string" && !CONTROL.test(v) && !/[^\u0000-ÿ]/.test(v);
const absent = (v: unknown) => v === undefined || v === null || v === "";

// Absent -> {}; otherwise a plain object of header-safe strings, else null.
function stringMap(v: unknown): Record<string, string> | null {
  if (absent(v)) return {};
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const entries = Object.entries(v as object);
  if (!entries.every(([k, val]) => HEADER_NAME.test(k) && sendable(val))) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    // Validate everything before the upsert: Prisma validation errors print the argument values
    // (the secrets) to the logs. The parse error is not logged either, it can quote the body.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return bad("Invalid request body");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return bad("Invalid request body");
    }

    const { cpoName, authToken: rawAuthToken, refreshToken, headers, cookies, expiresAt } = body as Record<string, unknown>;
    // A pasted token often ends in a newline: trim it before validating. An embedded one is still rejected.
    const authToken = typeof rawAuthToken === "string" ? rawAuthToken.trim() : rawAuthToken;

    if (typeof cpoName !== "string" || !cpoName.trim() || typeof authToken !== "string" || !authToken) {
      return bad("cpoName and authToken are required");
    }
    if (CONTROL.test(cpoName)) return bad("cpoName must not contain control characters");
    if (!sendable(authToken)) return bad("authToken must not contain control characters");
    if (!absent(refreshToken) && !sendable(refreshToken)) {
      return bad("refreshToken must not contain control characters");
    }
    const headerMap = stringMap(headers);
    if (!headerMap) return bad("headers must be an object of string values without control characters");
    const cookieMap = stringMap(cookies);
    if (!cookieMap) return bad("cookies must be an object of string values without control characters");

    let expires: Date | null = null;
    if (!absent(expiresAt)) {
      if (typeof expiresAt !== "string" && typeof expiresAt !== "number") return bad("expiresAt must be a valid date");
      expires = new Date(expiresAt);
      if (Number.isNaN(expires.getTime())) return bad("expiresAt must be a valid date");
    }

    const refresh = absent(refreshToken) ? null : (refreshToken as string);

    const cpoCred = await db.cpoCredential.upsert({
      where: { cpoName },
      create: {
        cpoName,
        authToken,
        refreshToken: refresh,
        headers: headerMap,
        cookies: cookieMap,
        expiresAt: expires,
        status: CredentialStatus.ACTIVE
      },
      update: {
        authToken,
        refreshToken: refresh,
        headers: headerMap,
        cookies: cookieMap,
        expiresAt: expires,
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
    // Name and Prisma code only: an error here can carry the submitted secrets in its message.
    console.error(
      "Admin API error configuring credentials:",
      (error as { code?: string } | null)?.code ?? (error as Error | null)?.name ?? "unknown error"
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
