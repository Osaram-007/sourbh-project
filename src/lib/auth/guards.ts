import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// Shared route guards (T0-04, ADR-0014). Call first in every handler:
//
//   const auth = await requireAdmin();
//   if (!auth.ok) return auth.response;
//
// Interim backing is the NextAuth session; T0-01 swaps the internals and keeps this API.
// ponytail: under the dev Credentials login the email is typed, not verified, so this is not
// real admin protection until T0-01 (verified Google email). Do not lean on it alone in prod.

export type GuardResult =
  | { ok: true; user: { id: string; email: string | null } }
  | { ok: false; response: NextResponse };

const deny = (error: string, status: number): GuardResult => ({
  ok: false,
  response: NextResponse.json({ error }, { status }),
});

// 401 when there is no session.
export async function requireUser(): Promise<GuardResult> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.id) return deny("Unauthorized", 401);
  return { ok: true, user: { id: user.id, email: user.email ?? null } };
}

// 401 no session, 403 not admin. Admin = role ADMIN AND email on ADMIN_EMAILS
// (comma-separated, read per request). An unset or empty ADMIN_EMAILS means no admins.
export async function requireAdmin(): Promise<GuardResult> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.id) return deny("Unauthorized", 401);

  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = user.email?.trim().toLowerCase();
  if (user.role !== "ADMIN" || !email || !allowed.includes(email)) {
    return deny("Forbidden", 403);
  }
  return { ok: true, user: { id: user.id, email: user.email ?? null } };
}
