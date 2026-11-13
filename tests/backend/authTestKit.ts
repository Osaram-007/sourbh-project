/**
 * Shared kit for the T0-04 auth tests (authGuards, routeGuards). Not a test file: the name has no
 * `.test.ts`, so the runner does not pick it up.
 *
 * Sessions are REAL NextAuth JWT cookies. signInAs() mints one with next-auth/jwt and serves it
 * through the only seam getServerSession() reads from: the request-scope helpers cookies() and
 * headers() of next/headers (they throw outside a Next request). Everything after that runs for
 * real: NextAuth verifies the token, authOptions.callbacks.session maps id/role/email, and the
 * guard decides. Only the request context is replaced, never NextAuth or the guards.
 *
 * Importing this file (do it FIRST) sets, before any app module loads:
 *  - DATABASE_URL to a closed local port, so nothing can reach a real database;
 *  - NEXTAUTH_SECRET and NEXTAUTH_URL, so the session cookie name and signing key are known.
 *
 * T0-01 replaces the NextAuth session, and that costs more than rewriting this file:
 *  - The role-based cases invert under ADR-0014. Role stops being an input; a verified Google email
 *    on ADMIN_EMAILS decides, so "ADMIN role without the email" and "USER role with the email"
 *    change meaning, and authGuards.test.ts and routeGuards.test.ts need a re-think, not a patch.
 *  - resolveSession() (ADR-0013) queries the database for the Session and User rows on every
 *    signed-in request. assertNoIo() in routeGuards.test.ts will see that access, so its
 *    "nothing touched the database" check only holds for anonymous requests; for signed-in paths,
 *    the 403 ones included, it has to be narrowed to "no access beyond the session lookup".
 */
import { mock } from "node:test";
import { encode } from "next-auth/jwt";

export const SECRET = "t0-04-test-only-secret-not-used-anywhere-else";
export const CANARY = "CANARY-7c1e-internal-detail-must-never-reach-a-client";

process.env.DATABASE_URL = "postgresql://x:x@127.0.0.1:1/x";
process.env.NEXTAUTH_SECRET = SECRET;
process.env.NEXTAUTH_URL = "http://localhost:3000"; // http => cookie name "next-auth.session-token"
delete process.env.ADMIN_EMAILS;
delete process.env.SYNC_SECRET_KEY;

const COOKIE_NAME = "next-auth.session-token";

export interface TestUser {
  id?: string;
  role?: string;
  email?: string | null;
}

/** A signed session token for `user`. Pass another `secret` to forge one. */
export function tokenFor(user: TestUser, secret = SECRET): Promise<string> {
  return encode({
    token: { id: user.id, role: user.role, email: user.email, sub: user.id },
    secret,
  });
}

// require, not import: getServerSession() require()s next/headers itself, so the mock has to patch
// that module's real exports object, which an ES import binding would not give us.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextHeaders = require("next/headers") as typeof import("next/headers");
let cookieValues: string[] = [];
let storeError: unknown = null;
const restores: Array<() => void> = [];

/** Call in before(). */
export function installRequestScope(): void {
  const h = mock.method(nextHeaders, "headers", async () => {
    if (storeError) throw storeError;
    return new Headers();
  });
  const c = mock.method(nextHeaders, "cookies", async () => {
    if (storeError) throw storeError;
    return { getAll: () => cookieValues.map((value) => ({ name: COOKIE_NAME, value })) };
  });
  restores.push(() => h.mock.restore(), () => c.mock.restore());
}

/** Call in after(). */
export function uninstallRequestScope(): void {
  while (restores.length) restores.pop()!();
  signOut();
}

/** The next request carries a valid session cookie for `user`. */
export async function signInAs(user: TestUser): Promise<void> {
  storeError = null;
  cookieValues = [await tokenFor(user)];
}

/** The next request carries this raw cookie value (forged, garbage, ...). */
export function presentCookie(value: string): void {
  storeError = null;
  cookieValues = [value];
}

/** The next request is anonymous: no cookie at all. */
export function signOut(): void {
  storeError = null;
  cookieValues = [];
}

/** Reading the session throws `err`: the session store is down. */
export function breakSessionStore(err: unknown = new Error(CANARY)): void {
  storeError = err;
}

export const ADMIN = { id: "u-admin", role: "ADMIN", email: "admin@example.com" } as const;
export const DRIVER = { id: "u-driver", role: "USER", email: "driver@example.com" } as const;

/** Set ADMIN_EMAILS for the next request; undefined removes it. */
export function setAdminEmails(value: string | undefined): void {
  if (value === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = value;
}
