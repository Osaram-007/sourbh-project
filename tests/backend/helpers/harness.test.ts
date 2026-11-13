/**
 * T1-03 self-tests for the backend harness. Always runs, except the DB round trip, which is
 * skipped without TEST_DATABASE_URL.
 */
import { assertTestDatabaseUrl, closeTestDb, dbSkip, perProcessDb, resetDb, setupTestDb, TEST_DATABASE_URL, testDbName, testPool } from "./db";
import { makeRequest, routeCtx, TEST_APP_ORIGIN } from "./request";
import {
  JWKS_ENV,
  PROJECT_ID_ENV,
  TEST_PROJECT_ID,
  getJwksUrl,
  issuerFor,
  mintAlgNone,
  mintExpired,
  mintIdToken,
  mintUnknownKid,
  mintWrongAudience,
  mintWrongIssuer,
  mintWrongKey,
  startJwks,
  stopJwks,
} from "./firebase";
import { execFileSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify, errors } from "jose";
import { route } from "@/lib/v1/http";

describe("firebase JWKS + minting", () => {
  before(startJwks);
  after(stopJwks);

  const verify = (token: string) => {
    const jwks = createRemoteJWKSet(new URL(getJwksUrl()));
    return jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      issuer: issuerFor(TEST_PROJECT_ID),
      audience: TEST_PROJECT_ID,
    });
  };

  it("serves on loopback and exports the env vars the verifier reads", () => {
    assert.match(getJwksUrl(), /^http:\/\/127\.0\.0\.1:\d+\//);
    assert.equal(process.env[JWKS_ENV], getJwksUrl());
    assert.equal(process.env[PROJECT_ID_ENV], TEST_PROJECT_ID);
  });

  it("a minted token verifies and carries the ADR-0003 claims", async () => {
    const { payload, protectedHeader } = await verify(await mintIdToken({ sub: "uid-42" }));
    assert.equal(protectedHeader.alg, "RS256");
    assert.equal(protectedHeader.kid, "test-key-1");
    assert.equal(payload.sub, "uid-42");
    assert.equal(payload.user_id, "uid-42");
    assert.equal(payload.iss, issuerFor(TEST_PROJECT_ID));
    assert.equal(payload.aud, TEST_PROJECT_ID);
    assert.equal((payload.firebase as { sign_in_provider: string }).sign_in_provider, "google.com");
    assert.ok(typeof payload.auth_time === "number" && payload.auth_time <= Math.floor(Date.now() / 1000));
    assert.ok(payload.exp! > payload.iat!);
  });

  it("claim overrides win, and undefined drops a claim", async () => {
    const { payload } = await verify(await mintIdToken({ auth_time: 123, user_id: undefined }));
    assert.equal(payload.auth_time, 123);
    assert.ok(!("user_id" in payload));
  });

  it("iss/aud/exp defaults are overridable too", async () => {
    const t = await mintIdToken({ iss: "x", aud: "y", exp: Math.floor(Date.now() / 1000) + 60, iat: undefined });
    const { payload } = await jwtVerify(t, createRemoteJWKSet(new URL(getJwksUrl())), { issuer: "x", audience: "y" });
    assert.ok(!("iat" in payload));
    assert.ok(payload.exp! < Math.floor(Date.now() / 1000) + 100);
  });

  const bad: Array<[string, () => Promise<string> | string, new (...a: never[]) => Error, string?]> = [
    ["expired", () => mintExpired(), errors.JWTExpired],
    ["wrong audience", () => mintWrongAudience(), errors.JWTClaimValidationFailed, "aud"],
    ["wrong issuer", () => mintWrongIssuer(), errors.JWTClaimValidationFailed, "iss"],
    ["unknown kid", () => mintUnknownKid(), errors.JWKSNoMatchingKey],
    ["different key", () => mintWrongKey(), errors.JWSSignatureVerificationFailed],
    ["alg none", () => mintAlgNone(), errors.JOSEAlgNotAllowed],
  ];
  for (const [name, mint, Err, claim] of bad) {
    it(`${name} is rejected for the right reason`, async () => {
      const token = await mint();
      await assert.rejects(verify(token), (e: unknown) => {
        assert.ok(e instanceof Err, `got ${(e as Error).name}: ${(e as Error).message}`);
        if (claim) assert.equal((e as errors.JWTClaimValidationFailed).claim, claim);
        return true;
      });
    });
  }
});

describe("request builder", () => {
  const ok = route({ auth: "none" }, () => NextResponse.json({ ok: true }));

  it("a POST with defaults passes the T1-02 CSRF check and the body arrives", async () => {
    let seen: unknown;
    const h = route<"none", { id: string }>({ auth: "none" }, ({ body, params }) => {
      seen = { body, params };
      return NextResponse.json({});
    });
    const res = await h(makeRequest({ method: "POST", path: "/api/v1/x", body: { a: 1 } }), routeCtx({ id: "s1" }));
    assert.equal(res.status, 200);
    assert.deepEqual(seen, { body: { a: 1 }, params: { id: "s1" } });
  });

  it("a cross-site POST is refused", async () => {
    const res = await ok(makeRequest({ method: "POST", secFetchSite: "cross-site" }), routeCtx());
    assert.equal(res.status, 403);
  });

  it("with no Sec-Fetch-Site, a matching Origin passes and a foreign one fails", async () => {
    const h = { method: "POST", secFetchSite: false } as const;
    assert.equal((await ok(makeRequest({ ...h, headers: { origin: TEST_APP_ORIGIN } }), routeCtx())).status, 200);
    assert.equal((await ok(makeRequest({ ...h, headers: { origin: "https://evil.example" } }), routeCtx())).status, 403);
  });

  it("importing request.ts overrides an inherited APP_ORIGIN", () => {
    const target = JSON.stringify(pathToFileURL(path.join(__dirname, "request.ts")).href);
    const out = execFileSync(process.execPath, ["--import", "tsx", "-e", `import(${target}).then(() => console.log(process.env.APP_ORIGIN))`], {
      env: { ...process.env, APP_ORIGIN: "https://inherited.example" },
      encoding: "utf8",
    });
    assert.equal(out.trim(), TEST_APP_ORIGIN);
  });

  it("builds query, cookies, headers and X-Forwarded-For", () => {
    const r = makeRequest({ path: "/api/v1/s?limit=5", cookies: { a: "b c" }, headers: { "X-Test": "1" }, ip: "1.2.3.4" });
    assert.equal(r.nextUrl.searchParams.get("limit"), "5");
    assert.equal(r.cookies.get("a")?.value, "b c");
    assert.equal(r.headers.get("x-test"), "1");
    assert.equal(r.headers.get("x-forwarded-for"), "1.2.3.4");
    assert.equal(r.headers.get("sec-fetch-site"), "same-origin");
    assert.equal(r.headers.get("origin"), TEST_APP_ORIGIN);
  });
});

describe("db guard", () => {
  const url = (name: string) => `postgresql://u:p@127.0.0.1:5432/${name}`;
  it("throws when the database name lacks a test token, or the URL is junk or unset", () => {
    assert.throws(() => assertTestDatabaseUrl(url("fullcharge")), /"test" token/);
    assert.throws(() => assertTestDatabaseUrl(url("prod?x=test")), /"test" token/);
    assert.throws(() => assertTestDatabaseUrl(url("fullcharge_latest")), /"test" token/);
    assert.throws(() => assertTestDatabaseUrl(url("contest")), /"test" token/);
    assert.throws(() => assertTestDatabaseUrl("postgresql://test:test@test-host:5432/prod"), /"test" token/);
    assert.throws(() => assertTestDatabaseUrl("not a url"), /not a valid URL/);
    assert.throws(() => assertTestDatabaseUrl(undefined), /not set/);
  });
  it("accepts names with a test token", () => {
    for (const n of ["fullcharge_test", "test", "fc-test-db", "fullcharge_test_1234"]) {
      assert.equal(assertTestDatabaseUrl(url(n)), url(n));
    }
  });
  it("rejects a schema query parameter", () => {
    assert.throws(() => assertTestDatabaseUrl(url("fullcharge_test?schema=other")), /schema/);
  });
  it("derives <base>_<pid>, keeping host and credentials, and never the base name", () => {
    const d = perProcessDb(url("fullcharge_test?sslmode=disable"), 4242);
    assert.equal(d.name, "fullcharge_test_4242");
    assert.equal(d.url, "postgresql://u:p@127.0.0.1:5432/fullcharge_test_4242?sslmode=disable");
    assert.notEqual(perProcessDb(url("test"), 1).name, "test");
    assert.throws(() => perProcessDb(url("fullcharge"), 1), /"test" token/);
  });
  it("rejects a derived name over 63 bytes (Postgres would truncate the pid)", () => {
    const base60 = "a".repeat(55) + "_test"; // 60 bytes; "_" + 4-digit pid makes 65
    assert.equal(Buffer.byteLength(base60), 60);
    assert.throws(() => perProcessDb(url(base60), 1234), /over 63 bytes/);
    assert.equal(perProcessDb(url("a".repeat(50) + "_test"), 1234).name.length, 60); // fits
  });
  it("pins DATABASE_URL: to the per-process DB, or to a closed port when TEST_DATABASE_URL is unset", () => {
    if (TEST_DATABASE_URL) assert.equal(process.env.DATABASE_URL, perProcessDb(TEST_DATABASE_URL).url);
    else assert.equal(process.env.DATABASE_URL, "postgresql://x:x@127.0.0.1:1/x_test");
  });
});

describe("db round trip", { skip: dbSkip, timeout: 120_000 }, () => {
  before(setupTestDb);
  after(closeTestDb);

  it("migrate, insert, reset, then empty (and _prisma_migrations survives)", async () => {
    await resetDb();
    const p = testPool();
    // the per-process DB, not the shared base DB; setupTestDb also checked the app client (@/lib/db) is on it
    assert.equal((await p.query("SELECT current_database() AS d")).rows[0].d, testDbName);
    assert.notEqual(testDbName, process.env.TEST_DATABASE_URL!.split("/").pop()!.split("?")[0]);
    await p.query(`INSERT INTO "User" (id, email) VALUES ('u1', 'a@example.com')`);
    assert.equal((await p.query(`SELECT 1 FROM "User"`)).rowCount, 1);
    await resetDb();
    assert.equal((await p.query(`SELECT 1 FROM "User"`)).rowCount, 0);
    assert.ok(((await p.query(`SELECT 1 FROM _prisma_migrations`)).rowCount ?? 0) > 0);
  });
});
