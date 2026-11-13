/**
 * T1-02 (api-v1 1.1-1.4 and 1.7, ADR-0008/0009/0013/0018): the shared /api/v1 route wrapper.
 * Written against the contract, not the code. No database, no network; always runs.
 *
 *   npx tsx --test tests/backend/v1/http.test.ts
 *
 * Guards seam (no source edit): the wrapper calls requireUser()/requireAdmin(), which are backed by
 * NextAuth's getServerSession(). authTestKit.ts (T0-04) mints a REAL signed NextAuth session cookie
 * and serves it through the only seam getServerSession() reads, next/headers cookies()/headers().
 * So the guards and NextAuth run for real; signInAs(...) / signOut() decide who is calling. The
 * wrapper's own request (cookies, Authorization) is separate from that and is set per test.
 *
 * Rate limiting: the limiter is one process-wide map, so every request gets its own X-Forwarded-For
 * address (and users their own id) and tests do not share buckets.
 */
import {
  ADMIN,
  CANARY,
  DRIVER,
  breakSessionStore,
  installRequestScope,
  setAdminEmails,
  signInAs,
  signOut,
  uninstallRequestScope,
} from "../authTestKit";
import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fail, parseBody, parseQuery, route } from "@/lib/v1/http";

const APP = "https://app.example.com";
const URL_ = "http://localhost/api/v1/x";
const MAX = 16 * 1024;

let ipSeq = 0;
const nextIp = () => `10.1.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
let userSeq = 0;
const freshUser = () => ({ ...DRIVER, id: `u-http-${++userSeq}`, email: `d${userSeq}@example.com` });

const SAME = { "sec-fetch-site": "same-origin" };
const JSON_CT = { "content-type": "application/json" };

interface Opts {
  headers?: Record<string, string>;
  body?: BodyInit | null;
  ip?: string;
}
const rq = (method: string, o: Opts = {}) =>
  new NextRequest(URL_, {
    method,
    headers: { "x-forwarded-for": o.ip ?? nextIp(), ...o.headers },
    body: o.body ?? undefined,
    ...(o.body && typeof o.body === "object" && "getReader" in o.body ? { duplex: "half" } : {}),
  } as ConstructorParameters<typeof NextRequest>[1]);
// Default P matches route()'s default, so a route whose handler ignores params type-checks too.
const ctx = <P extends object = Record<string, never>>(params = {} as P) => ({ params: Promise.resolve(params) });

const seen: Array<{ user: unknown; body: unknown; params: unknown }> = [];
const handler = (c: { user: unknown; body: unknown; params: unknown }) => {
  seen.push({ user: c.user, body: c.body, params: c.params });
  return NextResponse.json({ ok: true });
};
const none = route({ auth: "none" }, handler);
const asUser = route({ auth: "user" }, handler);
const asAdmin = route({ auth: "admin" }, handler);

/** The standard envelope, no-store, JSON. */
async function assertError(res: Response, status: number, code: string) {
  assert.equal(res.status, status);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, "string");
  assert.ok(body.error.message.length > 0);
  for (const k of Object.keys(body.error)) assert.ok(["code", "message", "details"].includes(k), `unexpected error key ${k}`);
  return body.error as { code: string; message: string; details?: { fields?: Record<string, string> } };
}

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

before(() => {
  installRequestScope();
  mock.method(console, "error", () => {});
});
after(() => {
  uninstallRequestScope();
  mock.restoreAll();
});
beforeEach(() => {
  signOut();
  seen.length = 0;
  setEnv("APP_ORIGIN", APP);
  setEnv("ADMIN_EMAILS", ADMIN.email);
  for (const k of ["RATE_LIMIT_IP_PER_MIN", "RATE_LIMIT_USER_PER_MIN", "RATE_LIMIT_USER_WRITES_PER_MIN"]) setEnv(k, undefined);
});

describe("auth modes", () => {
  it("none: no credential needed, user is null, handler gets path params", async () => {
    const res = await none(rq("GET"), ctx({ id: "s1" }));
    assert.equal(res.status, 200);
    assert.deepEqual(seen, [{ user: null, body: undefined, params: { id: "s1" } }]);
  });

  it("none: a session cookie that is sent is ignored (user stays null)", async () => {
    await signInAs(DRIVER);
    await none(rq("GET"), ctx());
    assert.equal(seen[0].user, null);
  });

  it("user: anonymous gets 401 auth_missing, handler not run", async () => {
    await assertError(await asUser(rq("GET"), ctx()), 401, "auth_missing");
    assert.equal(seen.length, 0);
  });

  it("user: a signed-in user reaches the handler with id and email", async () => {
    const u = freshUser();
    await signInAs(u);
    const res = await asUser(rq("GET"), ctx());
    assert.equal(res.status, 200);
    assert.deepEqual(seen[0].user, { id: u.id, email: u.email });
  });

  it("admin: anonymous gets 401 auth_missing", async () => {
    await assertError(await asAdmin(rq("GET"), ctx()), 401, "auth_missing");
    assert.equal(seen.length, 0);
  });

  it("admin: a non-admin gets 403 forbidden in the v1 envelope, handler not run", async () => {
    await signInAs(freshUser());
    await assertError(await asAdmin(rq("GET"), ctx()), 403, "forbidden");
    assert.equal(seen.length, 0);
  });

  it("admin: an ADMIN-role user not on ADMIN_EMAILS gets 403", async () => {
    setAdminEmails("someone-else@example.com");
    await signInAs({ ...ADMIN, id: "u-adm-x" });
    await assertError(await asAdmin(rq("GET"), ctx()), 403, "forbidden");
  });

  it("admin: an allowlisted admin reaches the handler", async () => {
    await signInAs({ ...ADMIN, id: "u-adm-ok" });
    const res = await asAdmin(rq("GET"), ctx());
    assert.equal(res.status, 200);
    assert.equal((seen[0].user as { id: string }).id, "u-adm-ok");
  });

  it("the guard's raw body ({error: string}) never reaches the client", async () => {
    const body = await (await asUser(rq("GET"), ctx())).json();
    assert.equal(typeof body.error, "object");
  });
});

describe("CSRF (api-v1 1.2): mutating methods", () => {
  const METHODS = ["POST", "PUT", "PATCH", "DELETE"];

  describe("Sec-Fetch-Site present: only same-origin passes", () => {
    for (const m of METHODS) {
      it(`${m} same-origin passes`, async () => {
        assert.equal((await none(rq(m, { headers: SAME }), ctx())).status, 200);
      });
    }
    for (const site of ["cross-site", "same-site", "none", "SAME-ORIGIN-ish", ""]) {
      it(`POST ${JSON.stringify(site)} is 403 forbidden`, async () => {
        await assertError(await none(rq("POST", { headers: { "sec-fetch-site": site } }), ctx()), 403, "forbidden");
        assert.equal(seen.length, 0);
      });
    }
    for (const m of METHODS) {
      it(`${m} cross-site is 403`, async () => {
        await assertError(await none(rq(m, { headers: { "sec-fetch-site": "cross-site" } }), ctx()), 403, "forbidden");
      });
    }
    it("same-origin wins over a wrong Origin (the header decides when present)", async () => {
      assert.equal((await none(rq("POST", { headers: { ...SAME, origin: "https://evil.example" } }), ctx())).status, 200);
    });
    it("cross-site loses even with the right Origin", async () => {
      await assertError(await none(rq("POST", { headers: { "sec-fetch-site": "cross-site", origin: APP } }), ctx()), 403, "forbidden");
    });
  });

  describe("no Sec-Fetch-Site: Origin must equal APP_ORIGIN", () => {
    it("matching Origin passes", async () => {
      assert.equal((await none(rq("POST", { headers: { origin: APP } }), ctx())).status, 200);
    });
    it("a different host fails", async () => {
      await assertError(await none(rq("POST", { headers: { origin: "https://evil.example" } }), ctx()), 403, "forbidden");
    });
    it("a different scheme, port or subdomain fails", async () => {
      for (const o of ["http://app.example.com", "https://app.example.com:8443", "https://x.app.example.com", "https://app.example.com.evil.example", "null"]) {
        await assertError(await none(rq("POST", { headers: { origin: o } }), ctx()), 403, "forbidden");
      }
    });
    it("neither header: rejected", async () => {
      await assertError(await none(rq("POST"), ctx()), 403, "forbidden");
      assert.equal(seen.length, 0);
    });
    it("APP_ORIGIN given with a path or trailing slash still compares by origin", async () => {
      setEnv("APP_ORIGIN", `${APP}/`);
      assert.equal((await none(rq("POST", { headers: { origin: APP } }), ctx())).status, 200);
    });
  });

  describe("APP_ORIGIN unset or invalid fails closed", () => {
    for (const v of [undefined, "", "not a url", "app.example.com"]) {
      it(`APP_ORIGIN=${JSON.stringify(v)}: Origin-only request is 403`, async () => {
        setEnv("APP_ORIGIN", v);
        await assertError(await none(rq("POST", { headers: { origin: APP } }), ctx()), 403, "forbidden");
        await assertError(await none(rq("POST", { headers: { origin: "" } }), ctx()), 403, "forbidden");
      });
    }
    it("a Sec-Fetch-Site same-origin request does not depend on APP_ORIGIN", async () => {
      setEnv("APP_ORIGIN", undefined);
      assert.equal((await none(rq("POST", { headers: SAME }), ctx())).status, 200);
    });
  });

  describe("Bearer exemption: user/admin routes only, and only without a cookie", () => {
    const bearer = { authorization: "Bearer abc.def.ghi" };
    it("user route, Bearer, no cookie, no CSRF headers: CSRF is skipped (reaches the guard, 401 not 403)", async () => {
      await assertError(await asUser(rq("POST", { headers: bearer }), ctx()), 401, "auth_missing");
    });
    it("admin route: same exemption", async () => {
      await assertError(await asAdmin(rq("POST", { headers: bearer }), ctx()), 401, "auth_missing");
    });
    it("user route, Bearer scheme is case-insensitive", async () => {
      await assertError(await asUser(rq("POST", { headers: { authorization: "bearer abc" } }), ctx()), 401, "auth_missing");
    });
    it("user route, Bearer plus a Cookie header: CSRF still checked", async () => {
      await assertError(await asUser(rq("POST", { headers: { ...bearer, cookie: "fc_session=abc" } }), ctx()), 403, "forbidden");
    });
    it("user route, Bearer with no token, or another scheme: not exempt", async () => {
      for (const a of ["Bearer", "Bearer ", "Basic dXNlcjpwdw==", "Token abc", ""]) {
        await assertError(await asUser(rq("POST", { headers: { authorization: a } }), ctx()), 403, "forbidden");
      }
    });
    it("none route: Bearer does NOT exempt, the check always applies", async () => {
      await assertError(await none(rq("POST", { headers: bearer }), ctx()), 403, "forbidden");
      assert.equal(seen.length, 0);
    });
    it("none route: Bearer with a valid same-origin request passes as normal", async () => {
      assert.equal((await none(rq("POST", { headers: { ...bearer, ...SAME } }), ctx())).status, 200);
    });
  });

  describe("cookie-authenticated user routes are checked", () => {
    it("a signed-in cookie user posting cross-site is 403 and the handler does not run", async () => {
      await signInAs(freshUser());
      await assertError(await asUser(rq("POST", { headers: { "sec-fetch-site": "cross-site", cookie: "fc_session=abc" } }), ctx()), 403, "forbidden");
      assert.equal(seen.length, 0);
    });
    it("the CSRF check runs before auth: an anonymous cross-site POST is 403, not 401", async () => {
      await assertError(await asUser(rq("POST", { headers: { "sec-fetch-site": "cross-site" } }), ctx()), 403, "forbidden");
    });
    it("same-origin signed-in POST passes", async () => {
      await signInAs(freshUser());
      assert.equal((await asUser(rq("POST", { headers: SAME }), ctx())).status, 200);
    });
  });

  describe("safe methods are never checked", () => {
    it("GET with cross-site, a bad Origin, or no headers at all", async () => {
      const variants: Record<string, string>[] = [{ "sec-fetch-site": "cross-site" }, { origin: "https://evil.example" }, {}];
      for (const headers of variants) {
        assert.equal((await none(rq("GET", { headers }), ctx())).status, 200);
      }
    });
    it("GET cross-site on a user route reaches the guard (401), not CSRF (403)", async () => {
      await assertError(await asUser(rq("GET", { headers: { "sec-fetch-site": "cross-site" } }), ctx()), 401, "auth_missing");
    });
    it("GET with APP_ORIGIN unset still passes", async () => {
      setEnv("APP_ORIGIN", undefined);
      assert.equal((await none(rq("GET"), ctx())).status, 200);
    });
  });
});

describe("request bodies (api-v1 1.4)", () => {
  const post = (body: BodyInit | null, headers: Record<string, string> = JSON_CT) => rq("POST", { headers: { ...SAME, ...headers }, body });
  /** Valid JSON that is exactly `bytes` long: {"a":"xxx..."}. */
  const jsonOfSize = (bytes: number) => {
    const pad = bytes - Buffer.byteLength('{"a":""}');
    return `{"a":"${"x".repeat(pad)}"}`;
  };

  it("a JSON body reaches the handler, parsed", async () => {
    const res = await none(post(JSON.stringify({ a: 1, b: [2] })), ctx());
    assert.equal(res.status, 200);
    assert.deepEqual(seen[0].body, { a: 1, b: [2] });
  });

  it("a body-less POST gives body undefined and no error", async () => {
    assert.equal((await none(rq("POST", { headers: SAME }), ctx())).status, 200);
    assert.equal(seen[0].body, undefined);
  });

  it("JSON null and a bare string are valid bodies", async () => {
    await none(post("null"), ctx());
    await none(post('"hi"'), ctx());
    assert.deepEqual(seen.map((s) => s.body), [null, "hi"]);
  });

  it("charset parameter and case in Content-Type are fine", async () => {
    for (const ct of ["application/json; charset=utf-8", "Application/JSON", "application/json;charset=UTF-8"]) {
      assert.equal((await none(post('{"a":1}', { "content-type": ct }), ctx())).status, 200, ct);
    }
  });

  describe("size cap: 16,384 bytes", () => {
    it("exactly 16,384 bytes is accepted", async () => {
      const body = jsonOfSize(MAX);
      assert.equal(Buffer.byteLength(body), MAX);
      assert.equal((await none(post(body), ctx())).status, 200);
      assert.equal(seen.length, 1);
    });

    it("16,385 bytes is 413 payload_too_large, handler not run", async () => {
      const body = jsonOfSize(MAX + 1);
      assert.equal(Buffer.byteLength(body), MAX + 1);
      await assertError(await none(post(body), ctx()), 413, "payload_too_large");
      assert.equal(seen.length, 0);
    });

    it("the cap counts bytes, not characters", async () => {
      const body = `{"a":"${"é".repeat(8_200)}"}`; // 8,208 characters, 16,408 bytes
      assert.ok(body.length < MAX && Buffer.byteLength(body) > MAX);
      await assertError(await none(post(body), ctx()), 413, "payload_too_large");
    });

    it("a chunked body with no Content-Length is cut off at the cap", async () => {
      let pulls = 0;
      const chunk = new TextEncoder().encode(`${"x".repeat(1023)}\n`);
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (++pulls > 64) return c.close();
          c.enqueue(chunk);
        },
      }, { highWaterMark: 0 });
      const req = post(stream);
      assert.equal(req.headers.get("content-length"), null, "test setup: the body must be chunked");
      await assertError(await none(req, ctx()), 413, "payload_too_large");
      assert.ok(pulls <= 20, `the wrapper kept reading past the cap (${pulls} chunks)`);
      assert.equal(seen.length, 0);
    });

    it("a chunked body of exactly 16,384 bytes is accepted", async () => {
      const bytes = new TextEncoder().encode(jsonOfSize(MAX));
      const parts = [bytes.slice(0, 5_000), bytes.slice(5_000, 12_000), bytes.slice(12_000)];
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          parts.forEach((p) => c.enqueue(p));
          c.close();
        },
      });
      assert.equal((await none(post(stream), ctx())).status, 200);
    });

    it("a lying Content-Length (small) over a big body is still 413", async () => {
      const req = post(jsonOfSize(MAX + 5_000), { ...JSON_CT, "content-length": "10" });
      assert.equal(req.headers.get("content-length"), "10", "test setup: the lie must reach the wrapper");
      await assertError(await none(req, ctx()), 413, "payload_too_large");
      assert.equal(seen.length, 0);
    });

    it("a Content-Length over the cap is 413 even when the body is small", async () => {
      await assertError(await none(post('{"a":1}', { ...JSON_CT, "content-length": String(MAX + 1) }), ctx()), 413, "payload_too_large");
    });

    it("applies on PUT, PATCH and DELETE too", async () => {
      for (const m of ["PUT", "PATCH", "DELETE"]) {
        const req = rq(m, { headers: { ...SAME, ...JSON_CT }, body: jsonOfSize(MAX + 1) });
        await assertError(await none(req, ctx()), 413, "payload_too_large");
      }
    });

    it("an oversized body on a user route is refused after auth, not before: anonymous gets 401", async () => {
      await assertError(await asUser(post(jsonOfSize(MAX + 1)), ctx()), 401, "auth_missing");
    });
  });

  describe("Content-Type and syntax", () => {
    it("a non-JSON Content-Type with a body is 415", async () => {
      for (const ct of ["text/plain", "application/x-www-form-urlencoded", "application/jsonx", "application/json-patch+json", "multipart/form-data; boundary=x"]) {
        await assertError(await none(post('{"a":1}', { "content-type": ct }), ctx()), 415, "unsupported_media_type");
      }
      assert.equal(seen.length, 0);
    });

    it("a body with no Content-Type is 415", async () => {
      const req = post(new Uint8Array([123, 125]), {});
      req.headers.delete("content-type");
      await assertError(await none(req, ctx()), 415, "unsupported_media_type");
    });

    it("malformed JSON is 400 validation_failed, and the parser message does not leak", async () => {
      for (const bad of ["{not json", '{"a":', "", "{'a':1}", "undefined"].filter(Boolean)) {
        const res = await none(post(bad), ctx());
        const text = JSON.stringify(await assertError(res, 400, "validation_failed"));
        assert.doesNotMatch(text, /unexpected|position|token|JSON\.parse|line \d/i);
      }
      assert.equal(seen.length, 0);
    });

    it("invalid UTF-8 is 400, not a silently repaired body", async () => {
      await assertError(await none(post(new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d])), ctx()), 400, "validation_failed");
    });

    it("a GET never reads a body: no 415, body undefined", async () => {
      await none(rq("GET", { headers: { "content-type": "text/plain" } }), ctx());
      assert.equal(seen[0].body, undefined);
    });
  });
});

describe("validation helpers", () => {
  const schema = z.object({ name: z.string().min(2), age: z.number().int(), nested: z.object({ n: z.number() }).optional() });

  it("parseBody: a valid body returns data and ignores unknown fields", () => {
    const r = parseBody(schema, { name: "ab", age: 3, extra: true });
    assert.ok(r.ok);
    assert.deepEqual(r.data, { name: "ab", age: 3 });
  });

  it("parseBody: failure is 422 validation_failed with details.fields keyed by field", async () => {
    const r = parseBody(schema, { name: "a", age: "x", nested: { n: "no" } });
    assert.ok(!r.ok);
    const err = await assertError(r.response, 422, "validation_failed");
    assert.deepEqual(Object.keys(err.details!.fields!).sort(), ["age", "name", "nested.n"]);
    for (const v of Object.values(err.details!.fields!)) assert.equal(typeof v, "string");
  });

  it("parseBody: a non-object body is reported under a single key, not a crash", async () => {
    const r = parseBody(schema, null);
    assert.ok(!r.ok);
    const err = await assertError(r.response, 422, "validation_failed");
    assert.equal(Object.keys(err.details!.fields!).length, 1);
  });

  it("parseBody: the message never echoes the submitted value", async () => {
    const r = parseBody(z.object({ email: z.string().email() }), { email: "SECRET-VALUE-123" });
    assert.ok(!r.ok);
    assert.ok(!JSON.stringify(await r.response.json()).includes("SECRET-VALUE-123"));
  });

  it("parseQuery: failure is 400 (not 422) with details.fields", async () => {
    const r = parseQuery(z.object({ limit: z.coerce.number().max(50) }), { limit: "51" });
    assert.ok(!r.ok);
    const err = await assertError(r.response, 400, "validation_failed");
    assert.deepEqual(Object.keys(err.details!.fields!), ["limit"]);
  });

  it("parseQuery: success coerces and ignores unknown parameters", () => {
    const r = parseQuery(z.object({ limit: z.coerce.number().default(20) }), { limit: "7", zzz: "1" });
    assert.ok(r.ok);
    assert.deepEqual(r.data, { limit: 7 });
  });

  it("through a route: a handler returning the parseBody response gives 422", async () => {
    const r = route({ auth: "none" }, ({ body }) => {
      const p = parseBody(schema, body);
      return p.ok ? NextResponse.json(p.data) : p.response;
    });
    const res = await r(rq("POST", { headers: { ...SAME, ...JSON_CT }, body: '{"name":"a"}' }), ctx());
    await assertError(res, 422, "validation_failed");
  });
});

describe("fail()", () => {
  it("builds the envelope with a fixed message and no-store", async () => {
    const e = await assertError(fail(409, "conflict"), 409, "conflict");
    assert.ok(!("details" in e));
  });
  it("includes details when given, and merges extra headers without losing no-store", async () => {
    const res = fail(404, "station_gone", { mergedInto: "s2" }, { "X-Test": "1" });
    assert.equal(res.headers.get("x-test"), "1");
    const e = await assertError(res, 404, "station_gone");
    assert.deepEqual(e.details, { mergedInto: "s2" });
  });
  it("every code in api-v1 1.3 has a fixed message", async () => {
    const doc = fs.readFileSync(path.resolve(__dirname, "../../../docs/api-v1.md"), "utf8");
    const table = doc.slice(doc.indexOf("### 1.3"), doc.indexOf("### 1.4"));
    const rows = [...table.matchAll(/^\| (.+?) \| \d{3} \|/gm)].map((m) => m[1]);
    const codes = [...new Set(rows.flatMap((r) => [...r.matchAll(/`(\w+)`/g)].map((m) => m[1])))];
    assert.equal(codes.length, 17, `parsed ${codes.join(", ")}`);
    for (const code of codes) await assertError(fail(400, code as Parameters<typeof fail>[1]), 400, code);
  });
  it("an invented code does not compile (checked by tsc --noEmit, which includes this file)", () => {
    // @ts-expect-error made_up_code is not in api-v1 1.3
    assert.ok(() => fail(500, "made_up_code"));
  });
});

describe("error handling: a throw is a generic 500", () => {
  const boom = (thrown: unknown, auth: "none" | "user" = "none") =>
    route({ auth }, () => {
      throw thrown;
    });

  it("a handler throw gives 500 internal, and the message, stack and class never appear", async () => {
    const err = new TypeError(CANARY);
    const res = await boom(err)(rq("GET"), ctx());
    const text = JSON.stringify(await assertError(res, 500, "internal"));
    assert.ok(!text.includes(CANARY));
    assert.doesNotMatch(text, /TypeError|at \w|\.ts:/);
  });

  it("an async rejection and a non-Error throw are handled the same way", async () => {
    const rejecting = route({ auth: "none" }, async () => {
      throw new Error(CANARY);
    });
    await assertError(await rejecting(rq("GET"), ctx()), 500, "internal");
    for (const thrown of ["string " + CANARY, { message: CANARY }, undefined, null, 42]) {
      const res = await boom(thrown)(rq("GET"), ctx());
      const e = await assertError(res, 500, "internal");
      assert.ok(!JSON.stringify(e).includes(CANARY));
    }
  });

  it("params that reject give a 500, not an unhandled rejection", async () => {
    const res = await none(rq("GET"), { params: Promise.reject(new Error(CANARY)) });
    const e = await assertError(res, 500, "internal");
    assert.ok(!JSON.stringify(e).includes(CANARY));
  });

  it("a session store failure inside the guard is a 500 with no detail", async () => {
    breakSessionStore(new Error(CANARY));
    const res = await asUser(rq("GET"), ctx());
    const e = await assertError(res, 500, "internal");
    assert.ok(!JSON.stringify(e).includes(CANARY));
    assert.equal(seen.length, 0);
  });

  it("the error is logged server-side", async () => {
    const spy = console.error as unknown as ReturnType<typeof mock.method>;
    const before = spy.mock.callCount();
    await boom(new Error("x"))(rq("GET"), ctx());
    assert.ok(spy.mock.callCount() > before);
  });

  it("the log carries the path only: no search text or coordinates from the query (api-v1 1.9)", async () => {
    const spy = console.error as unknown as ReturnType<typeof mock.method>;
    const before = spy.mock.callCount();
    const req = new NextRequest(`${URL_}?q=${CANARY}&lat=12.34`, { headers: { "x-forwarded-for": nextIp() } });
    await assertError(await boom(new Error("x"))(req, ctx()), 500, "internal");
    const logged = spy.mock.calls.slice(before).flatMap((c) => c.arguments.map((a) => inspect(a)));
    assert.ok(logged.some((s) => s.includes("/api/v1/x")), "the path is logged");
    for (const s of logged) assert.ok(!s.includes(CANARY) && !s.includes("12.34"), `query reached the log: ${s}`);
  });

  it("a handler's own non-error responses pass through untouched", async () => {
    const teapot = route({ auth: "none" }, () => new Response("tea", { status: 418, headers: { "x-a": "b" } }));
    const res = await teapot(rq("GET"), ctx());
    assert.equal(res.status, 418);
    assert.equal(res.headers.get("x-a"), "b");
    assert.equal(await res.text(), "tea");
  });
});

describe("rate limiting (api-v1 1.7, ADR-0009)", () => {
  async function assert429(res: Response) {
    const e = await assertError(res, 429, "rate_limited");
    const ra = res.headers.get("retry-after");
    assert.match(ra ?? "", /^\d+$/, "Retry-After must be whole seconds");
    assert.ok(Number(ra) >= 1 && Number(ra) <= 60, `Retry-After ${ra}`);
    return e;
  }

  it("IP bucket: over the limit is 429 with Retry-After and a rate_limited body; handler not run", async () => {
    setEnv("RATE_LIMIT_IP_PER_MIN", "3");
    const ip = nextIp();
    for (let i = 0; i < 3; i++) assert.equal((await none(rq("GET", { ip }), ctx())).status, 200);
    seen.length = 0;
    await assert429(await none(rq("GET", { ip }), ctx()));
    assert.equal(seen.length, 0);
  });

  it("IP bucket: another address is unaffected", async () => {
    setEnv("RATE_LIMIT_IP_PER_MIN", "1");
    const ip = nextIp();
    await none(rq("GET", { ip }), ctx());
    await assert429(await none(rq("GET", { ip }), ctx()));
    assert.equal((await none(rq("GET"), ctx())).status, 200);
  });

  it("IP bucket applies to every auth mode and every method", async () => {
    setEnv("RATE_LIMIT_IP_PER_MIN", "1");
    for (const r of [none, asUser, asAdmin]) {
      const ip = nextIp();
      await r(rq("POST", { ip, headers: SAME }), ctx());
      await assert429(await r(rq("POST", { ip, headers: SAME }), ctx()));
    }
  });

  it("the IP limit is checked first: before CSRF and before auth", async () => {
    setEnv("RATE_LIMIT_IP_PER_MIN", "1");
    const ip = nextIp();
    await asUser(rq("POST", { ip }), ctx()); // 403 (CSRF), but it still counts
    await assert429(await asUser(rq("POST", { ip }), ctx()));
  });

  it("a prepended X-Forwarded-For entry does not dodge the limit (the proxy-appended entry is the key)", async () => {
    setEnv("RATE_LIMIT_IP_PER_MIN", "2");
    const real = nextIp();
    for (let i = 0; i < 2; i++) await none(rq("GET", { ip: `203.0.113.${i + 1}, ${real}` }), ctx());
    await assert429(await none(rq("GET", { ip: `203.0.113.99, ${real}` }), ctx()));
  });

  it("requests with no usable address share one bucket rather than bypassing the limit", async () => {
    setEnv("RATE_LIMIT_IP_PER_MIN", "2");
    const noIp = () => new NextRequest(URL_, { method: "GET", headers: { "x-forwarded-for": "garbage" } });
    await none(noIp(), ctx());
    await none(noIp(), ctx());
    await assert429(await none(noIp(), ctx()));
    setEnv("RATE_LIMIT_IP_PER_MIN", undefined);
  });

  it("IPv6 shares one IP bucket per /64; another /64 is unaffected", async () => {
    setEnv("RATE_LIMIT_IP_PER_MIN", "1");
    await none(rq("GET", { ip: "2001:db8:aa:1::1" }), ctx());
    await assert429(await none(rq("GET", { ip: "2001:db8:aa:1:ffff:ffff:ffff:ffff" }), ctx()));
    assert.equal((await none(rq("GET", { ip: "2001:db8:aa:2::1" }), ctx())).status, 200);
  });

  it("the limit comes from RATE_LIMIT_IP_PER_MIN; an unusable value falls back to the default 120", async () => {
    for (const v of ["not-a-number", "0", "-5", "Infinity"]) {
      setEnv("RATE_LIMIT_IP_PER_MIN", v);
      const ip = nextIp();
      for (let i = 0; i < 120; i++) assert.equal((await none(rq("GET", { ip }), ctx())).status, 200, `${v}: request ${i + 1}`);
      await assert429(await none(rq("GET", { ip }), ctx()));
    }
  });

  it("user bucket: counts per user across requests, other users unaffected", async () => {
    setEnv("RATE_LIMIT_USER_PER_MIN", "2");
    const [a, b] = [freshUser(), freshUser()];
    await signInAs(a);
    await asUser(rq("GET"), ctx());
    await asUser(rq("GET"), ctx());
    await assert429(await asUser(rq("GET"), ctx()));
    await signInAs(b);
    assert.equal((await asUser(rq("GET"), ctx())).status, 200);
  });

  it("user bucket: a different IP does not reset a user's limit", async () => {
    setEnv("RATE_LIMIT_USER_PER_MIN", "1");
    await signInAs(freshUser());
    await asUser(rq("GET"), ctx());
    await assert429(await asUser(rq("GET"), ctx()));
  });

  it("user bucket does not apply to anonymous (auth none) routes", async () => {
    setEnv("RATE_LIMIT_USER_PER_MIN", "1");
    await signInAs(freshUser());
    for (let i = 0; i < 3; i++) assert.equal((await none(rq("GET"), ctx())).status, 200);
  });

  it("write bucket: stricter per-user limit on mutating requests only", async () => {
    setEnv("RATE_LIMIT_USER_WRITES_PER_MIN", "2");
    await signInAs(freshUser());
    for (let i = 0; i < 2; i++) assert.equal((await asUser(rq("POST", { headers: SAME }), ctx())).status, 200);
    await assert429(await asUser(rq("POST", { headers: SAME }), ctx()));
    await assert429(await asUser(rq("DELETE", { headers: SAME }), ctx()));
    assert.equal((await asUser(rq("GET"), ctx())).status, 200, "reads are not write-limited");
  });

  it("write bucket default is 20 per minute", async () => {
    await signInAs(freshUser());
    for (let i = 0; i < 20; i++) assert.equal((await asUser(rq("PUT", { headers: SAME }), ctx())).status, 200, `write ${i + 1}`);
    await assert429(await asUser(rq("PUT", { headers: SAME }), ctx()));
  });

  it("user bucket default is 120 per minute", async () => {
    await signInAs(freshUser());
    for (let i = 0; i < 120; i++) assert.equal((await asUser(rq("GET"), ctx())).status, 200, `request ${i + 1}`);
    await assert429(await asUser(rq("GET"), ctx()));
  });

  it("a refused guard does not spend the user's buckets (anonymous hits only the IP bucket)", async () => {
    setEnv("RATE_LIMIT_USER_PER_MIN", "1");
    for (let i = 0; i < 3; i++) await assertError(await asUser(rq("GET"), ctx()), 401, "auth_missing");
  });
});
