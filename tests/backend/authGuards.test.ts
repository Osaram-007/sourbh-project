/**
 * T0-04 (AH-3, ADR-0014 interim, WL-RBAC-2): the shared guards requireUser() / requireAdmin() in
 * src/lib/auth/guards.ts.
 *
 * Intended behaviour (spec 4.2 AH-3, 7.3; task row T0-04):
 *  - 401 when there is no session; 403 when there is a session but it is not an admin.
 *  - Admin = role ADMIN AND the session email on ADMIN_EMAILS (comma-separated, trimmed,
 *    case-insensitive). Unset or empty ADMIN_EMAILS means nobody is admin. The role alone is
 *    never enough, and neither is a listed email on a USER.
 *  - Fail closed: if the session cannot be read, the guard must not say ok.
 *
 * No database and no secrets needed, so this always runs. Run:
 *   npx tsx --test tests/backend/authGuards.test.ts
 *
 * Sessions are real NextAuth JWT cookies (see authTestKit.ts), so the whole chain from cookie to
 * guard decision is exercised, including authOptions' session callback.
 */
import {
  ADMIN,
  DRIVER,
  breakSessionStore,
  installRequestScope,
  presentCookie,
  setAdminEmails,
  signInAs,
  signOut,
  tokenFor,
  uninstallRequestScope,
  type TestUser,
} from "./authTestKit";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { GuardResult } from "@/lib/auth/guards";

let guards: typeof import("@/lib/auth/guards");

before(async () => {
  installRequestScope();
  guards = await import("@/lib/auth/guards");
});
after(() => uninstallRequestScope());
beforeEach(() => {
  signOut();
  setAdminEmails(undefined);
});
afterEach(() => setAdminEmails(undefined));

/** Asserts a denial with `status` and returns its JSON body, which must be only { error: string }. */
async function denied(result: GuardResult, status: number) {
  assert.equal(result.ok, false, "expected the guard to deny");
  if (result.ok) return;
  assert.equal(result.response.status, status);
  const body = await result.response.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(typeof body.error, "string");
  return body as { error: string };
}

function allowed(result: GuardResult) {
  assert.equal(result.ok, true, "expected the guard to allow");
  if (!result.ok) throw new Error("unreachable");
  return result.user;
}

const adminWith = (email: string | null | undefined, role = "ADMIN"): TestUser => ({ id: "u1", role, email });

describe("requireUser", () => {
  it("answers 401 with no session", async () => {
    await denied(await guards.requireUser(), 401);
  });

  it("answers 401 for a cookie that is not a valid session token", async () => {
    presentCookie("garbage-not-a-jwt");
    await denied(await guards.requireUser(), 401);
  });

  it("answers 401 for a token signed with another secret (forged)", async () => {
    presentCookie(await tokenFor(ADMIN, "some-other-secret-an-attacker-might-guess"));
    await denied(await guards.requireUser(), 401);
  });

  it("answers 401 for a valid session that has no user id", async () => {
    await signInAs({ role: "USER", email: "driver@example.com" });
    await denied(await guards.requireUser(), 401);
  });

  it("lets a USER through and returns their id and email", async () => {
    await signInAs(DRIVER);
    assert.deepEqual(allowed(await guards.requireUser()), { id: DRIVER.id, email: DRIVER.email });
  });

  it("lets an ADMIN through too, and does not look at ADMIN_EMAILS", async () => {
    await signInAs(ADMIN);
    setAdminEmails(undefined);
    assert.equal(allowed(await guards.requireUser()).id, ADMIN.id);
  });

  it("returns email null for a user without one (phone-style account)", async () => {
    await signInAs({ id: "u9", role: "USER", email: null });
    assert.deepEqual(allowed(await guards.requireUser()), { id: "u9", email: null });
  });

  it("fails closed when the session store throws: it rejects and never reports ok", async () => {
    breakSessionStore(new Error("store down"));
    await assert.rejects(guards.requireUser(), /store down/);
  });
});

describe("requireAdmin: 401 versus 403", () => {
  it("answers 401 with no session, even when ADMIN_EMAILS lists people", async () => {
    setAdminEmails("admin@example.com");
    await denied(await guards.requireAdmin(), 401);
  });

  it("answers 401 for a garbage cookie and for a forged token", async () => {
    setAdminEmails("admin@example.com");
    presentCookie("garbage-not-a-jwt");
    await denied(await guards.requireAdmin(), 401);
    presentCookie(await tokenFor(ADMIN, "some-other-secret-an-attacker-might-guess"));
    await denied(await guards.requireAdmin(), 401);
  });

  it("answers 401 for a valid ADMIN session that has no user id", async () => {
    setAdminEmails("admin@example.com");
    await signInAs({ role: "ADMIN", email: "admin@example.com" });
    await denied(await guards.requireAdmin(), 401);
  });

  it("answers 403, not 401, for a signed-in USER", async () => {
    setAdminEmails("driver@example.com");
    await signInAs(DRIVER);
    await denied(await guards.requireAdmin(), 403);
  });

  it("does not echo the allowlist in the 403 body", async () => {
    setAdminEmails("secret-owner@example.com");
    await signInAs(DRIVER);
    const result = await guards.requireAdmin();
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.doesNotMatch(await result.response.text(), /secret-owner|example\.com/);
  });

  it("fails closed when the session store throws: it rejects and never reports ok", async () => {
    setAdminEmails("admin@example.com");
    breakSessionStore(new Error("store down"));
    await assert.rejects(guards.requireAdmin(), /store down/);
  });
});

describe("requireAdmin: role AND email on ADMIN_EMAILS", () => {
  describe("ADMIN role but the email is not listed => 403", () => {
    const cases: Array<[string, string | undefined]> = [
      ["ADMIN_EMAILS unset", undefined],
      ["ADMIN_EMAILS empty", ""],
      ["ADMIN_EMAILS only spaces", "   "],
      ["ADMIN_EMAILS only separators", " , ,, "],
      ["ADMIN_EMAILS lists someone else", "other@example.com"],
      ["listed address merely starts with the email", "admin@example.com.evil.test"],
      ["listed address merely ends with the email", "xadmin@example.com"],
      ["email is a substring of the whole value", "superadmin@example.com,other@example.com"],
      ["same local part, other domain", "admin@example.org"],
      ["separated by semicolon, not comma", "other@example.com;admin@example.com"],
      ["separated by space, not comma", "other@example.com admin@example.com"],
    ];
    for (const [label, value] of cases) {
      it(label, async () => {
        setAdminEmails(value);
        await signInAs(ADMIN);
        await denied(await guards.requireAdmin(), 403);
      });
    }
  });

  describe("ADMIN role and the email is listed => ok", () => {
    const cases: Array<[string, string]> = [
      ["exact", "admin@example.com"],
      ["upper case in ADMIN_EMAILS", "ADMIN@EXAMPLE.COM"],
      ["mixed case in ADMIN_EMAILS", "Admin@Example.Com"],
      ["padded with spaces", "  admin@example.com  "],
      ["padded with tab and newline", "\tadmin@example.com\n"],
      ["spaces around the comma", "other@example.com , admin@example.com ,third@example.com"],
      ["first of several", "admin@example.com,other@example.com"],
      ["last of several", "other@example.com,third@example.com,admin@example.com"],
      ["blank entries around it", ",, admin@example.com,, ,"],
    ];
    for (const [label, value] of cases) {
      it(label, async () => {
        setAdminEmails(value);
        await signInAs(ADMIN);
        assert.deepEqual(allowed(await guards.requireAdmin()), { id: ADMIN.id, email: ADMIN.email });
      });
    }

    it("matches when the session email has different case from the list", async () => {
      setAdminEmails("admin@example.com");
      await signInAs(adminWith("Admin@EXAMPLE.com"));
      allowed(await guards.requireAdmin());
    });
  });

  describe("the role is required as well: the email alone is not enough => 403", () => {
    it("USER role with a listed email", async () => {
      setAdminEmails("driver@example.com");
      await signInAs(DRIVER);
      await denied(await guards.requireAdmin(), 403);
    });

    for (const role of ["admin", "Admin", "MODERATOR", "OWNER", ""]) {
      it(`role ${JSON.stringify(role)} is not ADMIN`, async () => {
        setAdminEmails("admin@example.com");
        await signInAs(adminWith("admin@example.com", role));
        await denied(await guards.requireAdmin(), 403);
      });
    }

    it("no role at all", async () => {
      setAdminEmails("admin@example.com");
      await signInAs({ id: "u1", email: "admin@example.com" });
      await denied(await guards.requireAdmin(), 403);
    });
  });

  describe("ADMIN role without an email never matches, whatever the list says => 403", () => {
    for (const email of [null, undefined, "", "   "]) {
      for (const list of [undefined, "", ",", " , ", "admin@example.com"]) {
        it(`email ${JSON.stringify(email)} with ADMIN_EMAILS ${JSON.stringify(list)}`, async () => {
          setAdminEmails(list);
          await signInAs(adminWith(email));
          await denied(await guards.requireAdmin(), 403);
        });
      }
    }
  });

  it("reads ADMIN_EMAILS on every call: removing the email locks the same session out", async () => {
    await signInAs(ADMIN);
    setAdminEmails("admin@example.com");
    allowed(await guards.requireAdmin());
    setAdminEmails("someone-else@example.com");
    await denied(await guards.requireAdmin(), 403);
    setAdminEmails(undefined);
    await denied(await guards.requireAdmin(), 403);
    setAdminEmails("ADMIN@example.com");
    allowed(await guards.requireAdmin());
  });
});
