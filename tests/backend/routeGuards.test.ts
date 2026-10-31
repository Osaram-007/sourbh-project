/**
 * T0-04 route-level enforcement (spec 4.2 AH-3..AH-6, 7.3 matrix; WL-SEC-1, WL-RBAC-2, WL-APP-14,
 * WL-ADM-3). Calls the real route handlers with a NextRequest and a real NextAuth session cookie
 * (see authTestKit.ts). No real database, no secrets, no network: always runs.
 *
 *   npx tsx --test tests/backend/routeGuards.test.ts
 *
 * What stands in for what:
 *  - Database: `src/lib/db.ts` reuses globalThis.prisma when set, so a recording fake is installed
 *    there before any app module loads. Every property access on it is logged, so "refused before
 *    the database" is checked literally. This is a deliberate exception to ADR-0011's "don't mock
 *    Prisma": these cases check what a handler refuses and how it shapes a response, not queries,
 *    and the task requires tests that need no Postgres.
 *  - Backstops: net.Socket.connect is counted (the sync lock and any pg connection use it) and
 *    global fetch throws, so a refused request cannot start a sync or reach the network without
 *    failing the test. Real scrapers never run.
 *  - NextAuth, the guards and the handlers run for real.
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
  type TestUser,
} from "./authTestKit";
import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

delete process.env.REDIS_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

// ---------------------------------------------------------------------------------------------
// Recording fake database, installed where src/lib/db.ts looks for an existing client
// ---------------------------------------------------------------------------------------------
const touched: string[] = [];
let dbFailure = false;
let results: Record<string, unknown> = {};
const DEFAULT_RESULT: Record<string, unknown> = {
  findMany: [],
  groupBy: [],
  count: 0,
  findUnique: null,
  findFirst: null,
  create: { id: "new-id" },
  upsert: { id: "cred-1" },
  update: {},
  delete: {},
};

const fakeDb: object = new Proxy(
  {},
  {
    get(_t, model) {
      if (typeof model === "symbol" || model === "then") return undefined;
      touched.push(`db.${model}`);
      return new Proxy(
        {},
        {
          get(_m, method) {
            if (typeof method === "symbol") return undefined;
            return async () => {
              touched.push(`${model}.${method}`);
              if (dbFailure) throw new Error(CANARY);
              const key = `${model}.${method}`;
              return key in results ? results[key] : (DEFAULT_RESULT[method] ?? null);
            };
          },
        },
      );
    },
  },
);
(globalThis as unknown as { prisma: object }).prisma = fakeDb;

const connects = { count: 0 };
let fetchSpy: ReturnType<typeof mock.method>;

function resetIo() {
  touched.length = 0;
  connects.count = 0;
  fetchSpy.mock.resetCalls();
  dbFailure = false;
  results = {};
}
/** No database access, no connection attempt (a sync lock would be one), no network. */
function assertNoIo() {
  assert.deepEqual(touched, [], "the handler touched the database");
  assert.equal(connects.count, 0, "the handler tried to open a connection (database or sync lock)");
  assert.equal(fetchSpy.mock.callCount(), 0, "the handler used the network");
}

// ---------------------------------------------------------------------------------------------
// Route table: every API route file and its methods (spec 7.3). WL-RBAC-3 says a route file
// missing from the table must fail a test; see "table integrity" below.
// ---------------------------------------------------------------------------------------------
const ROUTE_FILES: Record<string, string[]> = {
  "admin/credentials": ["GET", "POST"],
  "admin/stats": ["GET"],
  "admin/sync": ["GET", "POST"],
  "analytics/fleet": ["GET"],
  "analytics/station/[id]": ["GET"],
  favorites: ["GET", "POST"],
  reviews: ["GET", "POST"],
  stations: ["GET"],
  "stations/[id]": ["GET"],
  "stations/search": ["GET"],
  sync: ["POST"], // machine route, x-sync-secret only: syncSecret.test.ts
  "auth/[...nextauth]": ["GET", "POST"], // NextAuth's own handlers
};
const NOT_IN_CASES = new Set(["sync", "auth/[...nextauth]"]);
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

type Handler = (req?: NextRequest, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
const routes: Record<string, Record<string, Handler>> = {};

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`http://localhost${url}`, init);
const postJson = (url: string, body: unknown) =>
  req(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

type Guard = "admin" | "user" | "public";
interface Case {
  file: string;
  method: string;
  /** Label, with the query string where one matters. */
  name: string;
  guard: Guard;
  /** Whether a handler that got past its guard reads or writes the database. */
  db: boolean;
  call: () => Promise<Response>;
}
const BBOX = "north=19.4&south=18.8&east=73.3&west=72.7";
const CASES: Case[] = [
  { file: "admin/credentials", method: "GET", name: "GET /api/admin/credentials", guard: "admin", db: true,
    call: () => routes["admin/credentials"].GET() },
  { file: "admin/credentials", method: "POST", name: "POST /api/admin/credentials", guard: "admin", db: true,
    call: () => routes["admin/credentials"].POST(postJson("/api/admin/credentials", { cpoName: "tata", authToken: "tok-1" })) },
  { file: "admin/stats", method: "GET", name: "GET /api/admin/stats", guard: "admin", db: true,
    call: () => routes["admin/stats"].GET() },
  { file: "admin/sync", method: "GET", name: "GET /api/admin/sync", guard: "admin", db: false,
    call: () => routes["admin/sync"].GET() },
  { file: "admin/sync", method: "POST", name: "POST /api/admin/sync", guard: "admin", db: false,
    call: () => routes["admin/sync"].POST(req("/api/admin/sync", { method: "POST" })) },
  { file: "analytics/fleet", method: "GET", name: "GET /api/analytics/fleet", guard: "admin", db: true,
    call: () => routes["analytics/fleet"].GET(req("/api/analytics/fleet?range=7d")) },
  { file: "analytics/station/[id]", method: "GET", name: "GET /api/analytics/station/[id]?quick=true", guard: "admin", db: true,
    call: () => routes["analytics/station/[id]"].GET(req("/api/analytics/station/s1?quick=true"), idCtx("s1")) },
  { file: "analytics/station/[id]", method: "GET", name: "GET /api/analytics/station/[id]", guard: "admin", db: true,
    call: () => routes["analytics/station/[id]"].GET(req("/api/analytics/station/s1?range=7d"), idCtx("s1")) },
  { file: "favorites", method: "GET", name: "GET /api/favorites", guard: "user", db: true,
    call: () => routes.favorites.GET() },
  { file: "favorites", method: "POST", name: "POST /api/favorites", guard: "user", db: true,
    call: () => routes.favorites.POST(postJson("/api/favorites", { stationId: "s1" })) },
  { file: "reviews", method: "POST", name: "POST /api/reviews", guard: "user", db: true,
    call: () => routes.reviews.POST(postJson("/api/reviews", { stationId: "s1", rating: 4 })) },
  // Unguarded reads that spec 7.3 keeps public.
  { file: "stations", method: "GET", name: "GET /api/stations", guard: "public", db: true,
    call: () => routes.stations.GET(req(`/api/stations?${BBOX}`)) },
  { file: "stations/[id]", method: "GET", name: "GET /api/stations/[id]", guard: "public", db: true,
    call: () => routes["stations/[id]"].GET(req("/api/stations/s1"), idCtx("s1")) },
  { file: "stations/search", method: "GET", name: "GET /api/stations/search?q=ab", guard: "public", db: true,
    call: () => routes["stations/search"].GET(req("/api/stations/search?q=ab")) },
  { file: "reviews", method: "GET", name: "GET /api/reviews?stationId=s1", guard: "public", db: true,
    call: () => routes.reviews.GET(req("/api/reviews?stationId=s1")) },
];
const adminCases = CASES.filter((c) => c.guard === "admin");
const guardedCases = CASES.filter((c) => c.guard !== "public");
const publicCases = CASES.filter((c) => c.guard === "public");

const ALLOWED_EMAIL = ADMIN.email;
const refusedByGuard = (status: number) => status === 401 || status === 403;

/** A refusal body is exactly { error: string }. */
async function assertRefusal(res: Response, status: number) {
  assert.equal(res.status, status);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(typeof body.error, "string");
}

/** A 500 body is exactly { error: string } and carries nothing from the thrown error. */
async function assertGeneric500(res: Response) {
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.ok(!text.includes(CANARY), `error detail reached the client: ${text}`);
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body), ["error"], "a 500 body may only carry `error`");
  assert.equal(typeof body.error, "string");
}

before(async () => {
  installRequestScope();
  fetchSpy = mock.method(globalThis, "fetch", async () => {
    throw new Error("network access is forbidden in this test");
  });
  const realConnect = net.Socket.prototype.connect;
  mock.method(net.Socket.prototype, "connect", function (this: net.Socket, ...args: unknown[]) {
    connects.count++;
    return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  });
  // Handlers log failures on purpose, and a permitted POST /api/admin/sync logs a refused sync lock.
  mock.method(console, "error", () => {});
  mock.method(console, "log", () => {});
  mock.method(console, "warn", () => {});

  for (const file of Object.keys(ROUTE_FILES)) {
    routes[file] = (await import(`@/app/api/${file}/route`)) as Record<string, Handler>;
  }
});
after(() => {
  uninstallRequestScope();
  mock.restoreAll();
});
beforeEach(() => {
  signOut();
  setAdminEmails(ALLOWED_EMAIL);
  resetIo();
});

describe("test harness", () => {
  it("routes use the recording fake database", async () => {
    const { db } = await import("@/lib/db");
    assert.equal(db as unknown, fakeDb);
  });
});

describe("anonymous requests get 401 before anything else runs (AH-3, AH-4, S1)", () => {
  for (const c of guardedCases) {
    it(c.name, async () => {
      await assertRefusal(await c.call(), 401);
      assertNoIo();
    });
  }

  it("covers the two routes the audit named: GET /api/admin/sync and ?quick=true", () => {
    const names = guardedCases.map((c) => c.name);
    assert.ok(names.includes("GET /api/admin/sync"));
    assert.ok(names.includes("GET /api/analytics/station/[id]?quick=true"));
    assert.ok(names.includes("POST /api/admin/credentials"));
  });
});

describe("a signed-in USER", () => {
  for (const c of adminCases) {
    it(`gets 403 from ${c.name}`, async () => {
      await signInAs(DRIVER);
      await assertRefusal(await c.call(), 403);
      assertNoIo();
    });
  }
  for (const c of guardedCases.filter((x) => x.guard === "user")) {
    it(`gets past the guard on ${c.name}`, async () => {
      await signInAs(DRIVER);
      const res = await c.call();
      assert.ok(!refusedByGuard(res.status), `a driver was refused with ${res.status}`);
    });
  }
});

describe("a signed-in USER whose email is on ADMIN_EMAILS still gets 403 (the role is required too)", () => {
  for (const c of adminCases) {
    it(c.name, async () => {
      setAdminEmails(DRIVER.email);
      await signInAs(DRIVER);
      await assertRefusal(await c.call(), 403);
      assertNoIo();
    });
  }
});

describe("an ADMIN-role session is refused with 403 unless its email is listed (S1, ADR-0014)", () => {
  const notListed: Array<[string, string | undefined, TestUser]> = [
    ["ADMIN_EMAILS unset", undefined, ADMIN],
    ["ADMIN_EMAILS empty", "", ADMIN],
    ["ADMIN_EMAILS lists someone else", "other@example.com", ADMIN],
    ["ADMIN session without an email", ALLOWED_EMAIL, { id: ADMIN.id, role: "ADMIN", email: null }],
  ];
  for (const [label, list, user] of notListed) {
    describe(label, () => {
      for (const c of adminCases) {
        it(c.name, async () => {
          setAdminEmails(list);
          await signInAs(user);
          await assertRefusal(await c.call(), 403);
          assertNoIo();
        });
      }
    });
  }
});

describe("an ADMIN on ADMIN_EMAILS gets past every guard", () => {
  for (const c of guardedCases) {
    it(c.name, async () => {
      await signInAs(ADMIN);
      const res = await c.call();
      assert.ok(!refusedByGuard(res.status), `an allowlisted admin was refused with ${res.status}`);
    });
  }

  it("with the allowlist in different case and padded", async () => {
    setAdminEmails("  ADMIN@Example.COM , other@example.com");
    await signInAs(ADMIN);
    for (const c of adminCases) {
      const res = await c.call();
      assert.ok(!refusedByGuard(res.status), `${c.name} refused an allowlisted admin with ${res.status}`);
    }
  });
});

describe("unguarded reads in spec 7.3 stay public", () => {
  for (const c of publicCases) {
    it(`${c.name} answers an anonymous caller`, async () => {
      const res = await c.call();
      assert.ok(!refusedByGuard(res.status), `${c.name} refused an anonymous caller with ${res.status}`);
    });
  }
  it("GET /api/stations returns 200 with the viewport rows for an anonymous caller", async () => {
    results["station.findMany"] = [{ id: "s1", name: "Alpha" }];
    const res = await routes.stations.GET(req(`/api/stations?${BBOX}`));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ id: "s1", name: "Alpha" }]);
  });
  it("GET /api/reviews returns 200 with reviews for an anonymous caller", async () => {
    const res = await routes.reviews.GET(req("/api/reviews?stationId=s1"));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).totalRatings, 0);
  });
});

describe("GET /api/admin/credentials never returns headers, cookies or a raw token (AH-5, S3, WL-ADM-3)", () => {
  const SECRETS = ["RAW-TOKEN-1", "RAW-REFRESH-1", "HDR-SECRET-1", "HDR-SECRET-2", "COOKIE-SECRET-1"];
  const row = (over: object) => ({
    id: "c1",
    cpoName: "tata",
    status: "ACTIVE",
    updatedAt: new Date("2026-10-30T10:00:00Z"),
    expiresAt: null,
    authToken: "RAW-TOKEN-1",
    refreshToken: "RAW-REFRESH-1",
    headers: { Authorization: "Bearer HDR-SECRET-1", "X-Api-Key": "HDR-SECRET-2" },
    cookies: { sid: "COOKIE-SECRET-1" },
    errorLogs: [{ id: "e1", statusCode: 401, message: "token expired", timestamp: new Date("2026-10-30T09:00:00Z") }],
    ...over,
  });

  it("returns masked rows only, even for an allowlisted admin", async () => {
    results["cpoCredential.findMany"] = [row({}), row({ id: "c2", cpoName: "ather", authToken: null, cookies: null, headers: {} })];
    await signInAs(ADMIN);

    const res = await routes["admin/credentials"].GET();
    assert.equal(res.status, 200);
    const text = await res.text();
    for (const secret of SECRETS) assert.ok(!text.includes(secret), `${secret} reached the client`);

    const rows = JSON.parse(text) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 2);
    for (const r of rows) {
      for (const key of ["headers", "cookies", "authToken", "refreshToken", "token"]) {
        assert.ok(!(key in r), `response row carries "${key}"`);
      }
    }
  });

  it("still tells the admin what they need: name, status, whether a token is set, error log", async () => {
    results["cpoCredential.findMany"] = [row({}), row({ id: "c2", cpoName: "ather", authToken: null })];
    await signInAs(ADMIN);

    const rows = (await (await routes["admin/credentials"].GET()).json()) as Array<Record<string, unknown>>;
    assert.equal(rows[0].cpoName, "tata");
    assert.equal(rows[0].status, "ACTIVE");
    assert.equal(rows[0].hasToken, true);
    assert.equal(rows[1].hasToken, false);
    assert.equal((rows[0].errorLogs as unknown[]).length, 1);
  });

  it("an anonymous caller gets no rows at all", async () => {
    results["cpoCredential.findMany"] = [row({})];
    const res = await routes["admin/credentials"].GET();
    assert.equal(res.status, 401);
    assert.ok(!(await res.text()).includes("RAW-TOKEN-1"));
  });

  it("POST does not echo the token, headers or cookies it was given", async () => {
    results["cpoCredential.upsert"] = row({});
    await signInAs(ADMIN);
    const res = await routes["admin/credentials"].POST(
      postJson("/api/admin/credentials", {
        cpoName: "tata",
        authToken: "RAW-TOKEN-1",
        refreshToken: "RAW-REFRESH-1",
        headers: { Authorization: "Bearer HDR-SECRET-1", "X-Api-Key": "HDR-SECRET-2" },
        cookies: { sid: "COOKIE-SECRET-1" },
      }),
    );
    assert.equal(res.status, 200);
    const text = await res.text();
    for (const secret of SECRETS) assert.ok(!text.includes(secret), `${secret} was echoed`);
  });
});

describe("no handler response carries error.message (AH-6)", () => {
  describe("the session store throws inside the guard (every guarded handler)", () => {
    for (const c of guardedCases) {
      it(c.name, async () => {
        breakSessionStore(new Error(CANARY));
        await assertGeneric500(await c.call());
        assertNoIo();
      });
    }
  });

  describe("the database throws after the guard passes", () => {
    for (const c of CASES.filter((x) => x.db)) {
      it(c.name, async () => {
        if (c.guard !== "public") await signInAs(ADMIN);
        dbFailure = true;
        await assertGeneric500(await c.call());
        assert.ok(touched.length > 0, "the case never reached the database, so it proved nothing");
      });
    }
  });

  describe("a malformed JSON body (the parser's message must not leak)", () => {
    const bad = (url: string) =>
      req(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    const targets: Array<[string, () => Promise<Response>]> = [
      ["POST /api/favorites", () => routes.favorites.POST(bad("/api/favorites"))],
      ["POST /api/reviews", () => routes.reviews.POST(bad("/api/reviews"))],
      ["POST /api/admin/credentials", () => routes["admin/credentials"].POST(bad("/api/admin/credentials"))],
    ];
    for (const [name, call] of targets) {
      it(name, async () => {
        await signInAs(ADMIN);
        const res = await call();
        assert.ok(res.status >= 400, `a malformed body was accepted with ${res.status}`);
        const text = await res.text();
        assert.doesNotMatch(text, /unexpected|json|token|position|property name/i);
        assert.deepEqual(Object.keys(JSON.parse(text)), ["error"]);
      });
    }
  });
});

describe("table integrity (WL-RBAC-3, WL-RBAC-2)", () => {
  const apiDir = path.resolve(__dirname, "../../src/app/api");
  const routeFilesOnDisk = fs
    .readdirSync(apiDir, { recursive: true, encoding: "utf8" })
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => p === "route.ts" || p.endsWith("/route.ts"))
    .map((p) => p.replace(/\/?route\.ts$/, ""));

  it("every route file under api/admin and api/analytics is in the table", () => {
    const missing = routeFilesOnDisk
      .filter((f) => f.startsWith("admin/") || f.startsWith("analytics/"))
      .filter((f) => !(f in ROUTE_FILES));
    assert.deepEqual(missing, [], "new admin/analytics route: add it to ROUTE_FILES and CASES, guarded");
  });

  it("every route file in the table exists", () => {
    const gone = Object.keys(ROUTE_FILES).filter((f) => !routeFilesOnDisk.includes(f));
    assert.deepEqual(gone, []);
  });

  it("each route file exports exactly the methods the table lists", () => {
    for (const [file, methods] of Object.entries(ROUTE_FILES)) {
      const exported = HTTP_METHODS.filter((m) => typeof routes[file][m] === "function");
      assert.deepEqual(exported, HTTP_METHODS.filter((m) => methods.includes(m)), `${file}: exported methods differ`);
    }
  });

  it("every method in the table has a case above (except the machine and NextAuth routes)", () => {
    const wanted = Object.entries(ROUTE_FILES)
      .filter(([file]) => !NOT_IN_CASES.has(file))
      .flatMap(([file, methods]) => methods.map((m) => `${file} ${m}`))
      .sort();
    const have = [...new Set(CASES.map((c) => `${c.file} ${c.method}`))].sort();
    assert.deepEqual(have, wanted);
  });

  it("no route handler reads the session or the role inline (WL-RBAC-2)", () => {
    const offenders: string[] = [];
    for (const f of routeFilesOnDisk) {
      const src = fs.readFileSync(path.join(apiDir, f, "route.ts"), "utf8");
      if (/getServerSession|\.role\b|["']ADMIN["']/.test(src)) offenders.push(f);
    }
    assert.deepEqual(offenders, [], "use requireUser()/requireAdmin() from @/lib/auth/guards");
  });

  it("no route handler reads error.message (AH-6)", () => {
    const offenders: string[] = [];
    for (const f of routeFilesOnDisk) {
      const src = fs.readFileSync(path.join(apiDir, f, "route.ts"), "utf8");
      if (/\b(?:error|err|e|ex)\.message\b/.test(src)) offenders.push(f);
    }
    assert.deepEqual(offenders, []);
  });
});
