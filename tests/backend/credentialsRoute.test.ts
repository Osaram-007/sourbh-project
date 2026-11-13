/**
 * T0-04 follow-up (AH-5, AH-6, S3, WL-ADM-3): /api/admin/credentials must not leak secrets, in
 * responses or in server logs.
 *
 *  - GET returns masked rows. A stored CrawlerLog.message can embed a token (fetch puts a bad header
 *    value into its error text), so log rows expose only id, statusCode, timestamp and a fixed
 *    message chosen by statusCode (401/403 "Token rejected", else "Crawler failed"), never the
 *    stored text.
 *  - POST validates the whole payload before the upsert: control characters, non-Latin-1, wrong
 *    types, bad header/cookie maps, unparseable dates and non-object bodies all give 400, with no
 *    database access, nothing echoed and nothing logged. Valid payloads keep working.
 *  - A database error on POST logs only its Prisma code or its name, never the submitted values
 *    (Prisma validation errors print the arguments, i.e. the secrets).
 *
 * No database and no secrets needed; always runs. Run:
 *   npx tsx --test tests/backend/credentialsRoute.test.ts
 *
 * Sessions are real NextAuth cookies (authTestKit.ts); the database is the recording fake
 * (fakeDb.ts), see the scope note in routeGuards.test.ts.
 */
import { ADMIN, installRequestScope, setAdminEmails, signInAs, signOut, uninstallRequestScope } from "./authTestKit";
import { calls, callsTo, failDb, resetDb, setDbResult, touched } from "./fakeDb";
import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import util from "node:util";
import { NextRequest } from "next/server";

let credentials: typeof import("@/app/api/admin/credentials/route");

// Everything the handler writes to the console, inspected deeply so an Error's message, stack and
// extra properties count as logged.
const logged: string[] = [];
const sink = (...args: unknown[]) => {
  logged.push(util.inspect(args, { depth: 8, breakLength: Infinity }));
};

const URL_ = "http://localhost/api/admin/credentials";
const postRaw = (raw: string) =>
  credentials.POST(new NextRequest(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: raw }));
const post = (body: unknown) => postRaw(JSON.stringify(body));

before(async () => {
  installRequestScope();
  for (const m of ["error", "log", "warn", "info", "debug"] as const) mock.method(console, m, sink);
  credentials = await import("@/app/api/admin/credentials/route");
});
after(() => {
  uninstallRequestScope();
  mock.restoreAll();
});
beforeEach(async () => {
  setAdminEmails(ADMIN.email);
  resetDb();
  logged.length = 0;
  signOut();
  await signInAs(ADMIN);
});

/** A 400 whose body is exactly { error: string }, with no DB access, no echo and no log of `marker`. */
async function assertRejected(res: Response, marker = "ECHOME") {
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.deepEqual(Object.keys(JSON.parse(text)), ["error"]);
  assert.ok(!text.includes(marker), `the response echoes the submitted value: ${text}`);
  assert.deepEqual(touched, [], "a rejected payload touched the database");
  assert.ok(!logged.join("\n").includes(marker), "a rejected payload was logged");
}

// ---------------------------------------------------------------------------------------------
describe("GET: stored crawler log text never reaches the client", () => {
  // The real shape of a failure: fetch rejects a header value and puts it in the error text.
  const STORED = 'Crawler failed: Headers.append: "Bearer SECRET-TOKEN-abc\ndef" is an invalid header value.';
  const credentialRow = (over: object = {}) => ({
    id: "c1",
    cpoName: "tata",
    status: "ACTIVE",
    updatedAt: new Date("2026-10-30T10:00:00Z"),
    expiresAt: null,
    authToken: "RAW-TOKEN-1",
    refreshToken: "RAW-REFRESH-1",
    headers: { Authorization: "Bearer SECRET-TOKEN-abc" },
    cookies: { sid: "COOKIE-SECRET-1" },
    errorLogs: [
      {
        id: "l1",
        cpoCredentialId: "c1",
        statusCode: 500,
        message: STORED,
        timestamp: new Date("2026-10-30T09:00:00Z"),
      },
      {
        id: "l2",
        cpoCredentialId: "c1",
        statusCode: 401,
        message: "Refresh failed for refreshToken=RAW-REFRESH-1 password=hunter2",
        timestamp: new Date("2026-10-30T08:00:00Z"),
        rawResponse: "SECRET-BODY",
        headers: { Authorization: "Bearer SECRET-TOKEN-abc" },
      },
    ],
    ...over,
  });
  const LEAKS = ["SECRET-TOKEN-abc", "hunter2", "SECRET-BODY", "Headers.append", "invalid header value", "RAW-REFRESH-1", "RAW-TOKEN-1", "COOKIE-SECRET-1"];

  it("keeps the stored message, token and all, out of the response", async () => {
    setDbResult("cpoCredential.findMany", [credentialRow()]);
    const res = await credentials.GET();
    assert.equal(res.status, 200);
    const text = await res.text();
    for (const leak of LEAKS) assert.ok(!text.includes(leak), `"${leak}" reached the client`);
  });

  it("exposes only id, statusCode, message and timestamp on a log row, even if the stored row has more", async () => {
    setDbResult("cpoCredential.findMany", [credentialRow()]);
    const rows = (await (await credentials.GET()).json()) as Array<{ errorLogs: Array<Record<string, unknown>> }>;
    assert.equal(rows[0].errorLogs.length, 2);
    for (const log of rows[0].errorLogs) {
      assert.deepEqual(Object.keys(log).sort(), ["id", "message", "statusCode", "timestamp"]);
      assert.equal(typeof log.message, "string");
    }
    assert.deepEqual(
      rows[0].errorLogs.map((l) => [l.id, l.statusCode, l.timestamp]),
      [
        ["l1", 500, "2026-10-30T09:00:00.000Z"],
        ["l2", 401, "2026-10-30T08:00:00.000Z"],
      ],
    );
  });

  it("the message is fixed text chosen by statusCode alone: 401 and 403 mean a rejected token, anything else a failed crawl", async () => {
    const log = (id: string, statusCode: number, message: string) => ({
      id,
      cpoCredentialId: "c1",
      statusCode,
      message,
      timestamp: new Date("2026-10-30T09:00:00Z"),
    });
    setDbResult("cpoCredential.findMany", [
      credentialRow({
        errorLogs: [
          log("a", 401, STORED),
          log("b", 403, "Crawler failed: something else entirely"),
          log("c", 500, STORED),
          log("d", 500, "Authentication failed. Token expired or rejected."),
          log("e", 429, "RAW-TOKEN-1"),
          log("f", 200, "401"),
        ],
      }),
    ]);
    const rows = (await (await credentials.GET()).json()) as Array<{ errorLogs: Array<{ id: string; message: string }> }>;
    const byId = Object.fromEntries(rows[0].errorLogs.map((l) => [l.id, l.message]));
    assert.deepEqual(byId, {
      a: "Token rejected, see server logs",
      b: "Token rejected, see server logs",
      c: "Crawler failed, see server logs",
      d: "Crawler failed, see server logs",
      e: "Crawler failed, see server logs",
      f: "Crawler failed, see server logs",
    });
    assert.ok(!Object.values(byId).includes(STORED));
  });

  it("a credential row exposes only its masked fields", async () => {
    setDbResult("cpoCredential.findMany", [credentialRow()]);
    const rows = (await (await credentials.GET()).json()) as Array<Record<string, unknown>>;
    assert.deepEqual(Object.keys(rows[0]).sort(), ["cpoName", "errorLogs", "expiresAt", "hasToken", "id", "status", "updatedAt"]);
    assert.equal(rows[0].hasToken, true);
  });

  it("a credential with no failures returns an empty log list", async () => {
    setDbResult("cpoCredential.findMany", [credentialRow({ errorLogs: [] })]);
    const rows = (await (await credentials.GET()).json()) as Array<{ errorLogs: unknown[] }>;
    assert.deepEqual(rows[0].errorLogs, []);
  });
});

// ---------------------------------------------------------------------------------------------
describe("POST: invalid payloads are rejected with 400 before any database access", () => {
  // Every bad value carries "ECHOME" so an echo or a log of it is caught.
  const ok = { cpoName: "ECHOME-cpo", authToken: "tok-ok-1" };
  const withField = (field: string, value: unknown) => ({ ...ok, [field]: value });
  const without = (field: string) => Object.fromEntries(Object.entries(ok).filter(([k]) => k !== field));

  const BAD_STRINGS: Array<[string, string]> = [
    ["CR", "ECHOME\rx"],
    ["LF", "ECHOME\nx"],
    ["CRLF header injection", "ECHOME\r\nX-Injected: 1"],
    ["NUL", "ECHOME\u0000x"],
    ["BEL", "ECHOME\u0007x"],
    ["DEL", "ECHOME\u007fx"],
    ["euro sign (non-Latin-1)", "ECHOME€"],
    ["U+0100, just past Latin-1", "ECHOMEĀ"],
    ["emoji", "ECHOME\u{1F600}"],
  ];
  const WRONG_TYPES: Array<[string, unknown]> = [
    ["number", 123],
    ["true", true],
    ["array", ["ECHOME"]],
    ["object", { a: "ECHOME" }],
  ];

  describe("authToken", () => {
    for (const [label, value] of BAD_STRINGS) {
      it(`rejects ${label}`, async () => assertRejected(await post(withField("authToken", value))));
    }
    for (const [label, value] of [...WRONG_TYPES, ["false", false] as [string, unknown], ["null", null] as [string, unknown]]) {
      it(`rejects ${label}`, async () => assertRejected(await post(withField("authToken", value))));
    }
    it("rejects an empty string", async () => assertRejected(await post(withField("authToken", ""))));
    it("rejects a token that is only whitespace, since it is empty once trimmed", async () => {
      for (const blank of [" ", "   ", "\n", "\r\n", "\t \n"]) {
        resetDb();
        await assertRejected(await post(withField("authToken", blank)));
      }
    });
    it("rejects a control character inside the token even when the ends are trimmed", async () => {
      for (const value of ["ECHOME\nx\n", "  ECHOME\r\nX-Injected: 1  ", "ECHOME\u0000x\n"]) {
        resetDb();
        await assertRejected(await post(withField("authToken", value)));
      }
    });
    it("rejects a missing token", async () => assertRejected(await post(without("authToken"))));
  });

  describe("cpoName", () => {
    it("rejects a missing name", async () => assertRejected(await post(without("cpoName"))));
    for (const value of ["", "   ", null, 123, true, ["ECHOME"], { a: "ECHOME" }]) {
      it(`rejects ${JSON.stringify(value)}`, async () => assertRejected(await post(withField("cpoName", value))));
    }
    for (const [label, bad] of BAD_STRINGS.slice(0, 4)) {
      it(`rejects ${label}`, async () => assertRejected(await post(withField("cpoName", bad))));
    }
  });

  describe("refreshToken", () => {
    for (const [label, value] of BAD_STRINGS) {
      it(`rejects ${label}`, async () => assertRejected(await post(withField("refreshToken", value))));
    }
    for (const [label, value] of [...WRONG_TYPES, ["false", false] as [string, unknown], ["zero", 0] as [string, unknown]]) {
      it(`rejects ${label}`, async () => assertRejected(await post(withField("refreshToken", value))));
    }
  });

  for (const field of ["headers", "cookies"] as const) {
    describe(field, () => {
      const notMaps: Array<[string, unknown]> = [
        ["an array", ["ECHOME"]],
        ["a string", "ECHOME"],
        ["a number", 5],
        ["zero", 0],
        ["true", true],
        ["false", false],
      ];
      for (const [label, value] of notMaps) {
        it(`rejects ${label} instead of a map`, async () => assertRejected(await post(withField(field, value))));
      }

      const badValues: Array<[string, unknown]> = [
        ["a number value", { "X-A": 1 }],
        ["a null value", { "X-A": null }],
        ["a boolean value", { "X-A": true }],
        ["a nested object value", { "X-A": { n: "ECHOME" } }],
        ["an array value", { "X-A": ["ECHOME"] }],
        ...BAD_STRINGS.map(([label, v]): [string, unknown] => [`a value with ${label}`, { "X-A": v }]),
        ["one bad value among good ones", { Good: "fine", "X-A": "ECHOME\r\nbad" }],
      ];
      for (const [label, value] of badValues) {
        it(`rejects ${label}`, async () => assertRejected(await post(withField(field, value))));
      }

      const badNames: Array<[string, string]> = [
        ["a space in the name", "bad ECHOME"],
        ["a colon in the name", "bad:ECHOME"],
        ["an empty name", ""],
        ["a newline in the name", "X-A\nECHOME"],
        ["a non-ASCII name", "ECHOME-Ünï"],
        ["parentheses in the name", "X(ECHOME)"],
        ["a semicolon in the name", "a;ECHOME"],
      ];
      for (const [label, name] of badNames) {
        it(`rejects ${label}`, async () => assertRejected(await post(withField(field, { [name]: "v" }))));
      }
    });
  }

  describe("expiresAt", () => {
    for (const [label, value] of [
      ["unparseable text", "ECHOME-not-a-date"],
      ["an impossible date", "2026-13-45"],
      ["an object", {}],
      ["an array", []],
      ["true", true],
      ["false", false],
      ["a number past the Date range", 8640000000000001],
    ] as Array<[string, unknown]>) {
      it(`rejects ${label}`, async () => assertRejected(await post(withField("expiresAt", value))));
    }
  });

  describe("wrong types for the required fields", () => {
    it("cpoName as a number", async () => assertRejected(await post({ cpoName: 123, authToken: "ECHOME" })));
    it("authToken as a number", async () => assertRejected(await post({ cpoName: "ECHOME", authToken: 123 })));
  });

  describe("bodies that are not a JSON object", () => {
    const bodies: Array<[string, string]> = [
      ["an array", '["ECHOME"]'],
      ["an array holding a valid payload", '[{"cpoName":"ECHOME","authToken":"t"}]'],
      ["null", "null"],
      ["a string", '"ECHOME"'],
      ["a number", "123"],
      ["true", "true"],
    ];
    for (const [label, raw] of bodies) {
      it(`rejects ${label}`, async () => assertRejected(await postRaw(raw)));
    }
  });

  describe("malformed JSON: 400, and nothing containing the body is logged", () => {
    const bodies: Array<[string, string]> = [
      ["not JSON at all", "ECHOME-body not json"],
      ["a stray token after a value", '{"cpoName":"x","authToken":"ECHOME-secret" oops}'],
      ["a truncated body", '{"cpoName":"tata","authToken":"ECHOME-secret'],
      ["unquoted keys", "{authToken: 'ECHOME-secret'}"],
      ["an empty body", ""],
    ];
    for (const [label, raw] of bodies) {
      it(label, async () => {
        const res = await postRaw(raw);
        await assertRejected(res);
        assert.equal(logged.length, 0, `something was logged for a malformed body: ${logged.join("\n")}`);
      });
    }
  });

  it("never writes: no upsert call across a mixed batch of bad payloads", async () => {
    for (const body of [withField("authToken", "ECHOME\nx"), withField("headers", ["x"]), withField("expiresAt", "nope")]) {
      await post(body);
    }
    assert.deepEqual(callsTo("cpoCredential.upsert"), []);
    assert.deepEqual(calls, []);
  });
});

// ---------------------------------------------------------------------------------------------
describe("POST: valid payloads still work", () => {
  const upsertArgs = () => {
    const found = callsTo("cpoCredential.upsert");
    assert.equal(found.length, 1, "expected exactly one upsert");
    return found[0][0] as {
      where: { cpoName: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
  };

  it("minimal payload: name and token, everything else defaulted", async () => {
    const res = await post({ cpoName: "tata", authToken: "tok-1" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.id, "cred-1");

    const args = upsertArgs();
    assert.deepEqual(args.where, { cpoName: "tata" });
    assert.deepEqual(args.create, {
      cpoName: "tata",
      authToken: "tok-1",
      refreshToken: null,
      headers: {},
      cookies: {},
      expiresAt: null,
      status: "ACTIVE",
    });
    const { updatedAt, ...update } = args.update;
    assert.ok(updatedAt instanceof Date);
    assert.deepEqual(update, {
      authToken: "tok-1",
      refreshToken: null,
      headers: {},
      cookies: {},
      expiresAt: null,
      status: "ACTIVE",
    });
  });

  it("full payload: values reach the upsert unchanged and the date is parsed", async () => {
    const res = await post({
      cpoName: "ather",
      authToken: "Bearer abc.def==",
      refreshToken: "ref-1",
      headers: { Authorization: "Bearer abc.def==", "X-Custom_1.2": "a b; c=d", accept: "*/*" },
      cookies: { sid: "abc123", "x-theme": "dark" },
      expiresAt: "2030-01-02T03:04:05Z",
    });
    assert.equal(res.status, 200);
    const { create, update } = upsertArgs();
    assert.equal(create.refreshToken, "ref-1");
    assert.deepEqual(create.headers, { Authorization: "Bearer abc.def==", "X-Custom_1.2": "a b; c=d", accept: "*/*" });
    assert.deepEqual(create.cookies, { sid: "abc123", "x-theme": "dark" });
    assert.deepEqual(create.expiresAt, new Date("2030-01-02T03:04:05Z"));
    // The update branch (an existing credential being re-submitted) must carry the same values.
    const { updatedAt, ...rest } = update;
    assert.ok(updatedAt instanceof Date);
    assert.deepEqual(rest, {
      authToken: "Bearer abc.def==",
      refreshToken: "ref-1",
      headers: { Authorization: "Bearer abc.def==", "X-Custom_1.2": "a b; c=d", accept: "*/*" },
      cookies: { sid: "abc123", "x-theme": "dark" },
      expiresAt: new Date("2030-01-02T03:04:05Z"),
      status: "ACTIVE",
    });
  });

  it("trims the token before validating and stores the trimmed value, in create and update", async () => {
    for (const [raw, stored] of [
      ["tok-1\n", "tok-1"],
      ["tok-1\r\n", "tok-1"],
      ["  tok-1  ", "tok-1"],
      ["\ttok-1\n\n", "tok-1"],
      ["tok one", "tok one"],
    ]) {
      resetDb();
      const res = await post({ cpoName: "tata", authToken: raw });
      assert.equal(res.status, 200, `token ${JSON.stringify(raw)}`);
      const { create, update } = upsertArgs();
      assert.equal(create.authToken, stored);
      assert.equal(update.authToken, stored);
    }
  });

  it("every value it accepts is also accepted by fetch's own Headers (the 'fetch can send it' guarantee)", async () => {
    // Table of values the handler must accept, then every single character U+0000..U+00FF between
    // two letters: whatever the handler accepts has to pass new Headers(), the real validator.
    const table = [
      "tok-1",
      "Bearer abc.def==",
      "a b; c=d",
      "*/*",
      "café",
      "tok-é-ÿ",
      "aÿz",
      " ".repeat(3) + "padded" + " ".repeat(3),
      "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
      "  and ~",
      "a".repeat(4096),
    ];
    const probes = Array.from({ length: 256 }, (_, cp) => `a${String.fromCharCode(cp)}z`);
    let accepted = 0;
    for (const value of [...table, ...probes]) {
      resetDb();
      const res = await post({
        cpoName: "tata",
        authToken: value,
        refreshToken: value,
        headers: { "X-V": value },
        cookies: { sid: value },
      });
      const isTable = table.includes(value);
      if (res.status !== 200) {
        assert.ok(!isTable, `the table value ${JSON.stringify(value)} was rejected with ${res.status}`);
        continue;
      }
      accepted++;
      const { create } = upsertArgs();
      const h = create.headers as Record<string, string>;
      const c = create.cookies as Record<string, string>;
      for (const [name, v] of [
        ["Authorization", `Bearer ${create.authToken}`],
        ["X-Refresh", create.refreshToken as string],
        ["X-V", h["X-V"]],
        ["Cookie", `sid=${c.sid}`],
      ]) {
        assert.doesNotThrow(() => new Headers().append(name, v), `fetch's Headers rejects ${name}: ${JSON.stringify(v)}`);
      }
      assert.doesNotThrow(() => new Headers(h), `fetch's Headers rejects the stored headers for ${JSON.stringify(value)}`);
    }
    // Not vacuous: the table plus the printable and Latin-1 probes were accepted (95 + 128 probes).
    assert.ok(accepted >= table.length + 95 + 128, `only ${accepted} values were accepted`);
  });

  it("accepts a numeric epoch for expiresAt", async () => {
    const res = await post({ cpoName: "tata", authToken: "t", expiresAt: 1893456000000 });
    assert.equal(res.status, 200);
    assert.deepEqual(upsertArgs().create.expiresAt, new Date(1893456000000));
  });

  it('turns "" and null into null for refreshToken and expiresAt', async () => {
    for (const absent of ["", null]) {
      resetDb();
      const res = await post({ cpoName: "tata", authToken: "t", refreshToken: absent, expiresAt: absent });
      assert.equal(res.status, 200, `absent value ${JSON.stringify(absent)}`);
      const { create, update } = upsertArgs();
      assert.equal(create.refreshToken, null);
      assert.equal(create.expiresAt, null);
      assert.equal(update.refreshToken, null);
      assert.equal(update.expiresAt, null);
    }
  });

  it('turns null, "" and a missing value into {} for headers and cookies', async () => {
    for (const absent of [null, "", undefined]) {
      resetDb();
      const res = await post({ cpoName: "tata", authToken: "t", headers: absent, cookies: absent });
      assert.equal(res.status, 200, `absent value ${JSON.stringify(absent)}`);
      const { create, update } = upsertArgs();
      assert.deepEqual(create.headers, {});
      assert.deepEqual(create.cookies, {});
      assert.deepEqual(update.headers, {});
      assert.deepEqual(update.cookies, {});
    }
  });

  it("accepts Latin-1 text, including the last Latin-1 character U+00FF", async () => {
    const res = await post({ cpoName: "tata", authToken: "tok-é-ÿ", headers: { "X-Note": "café" } });
    assert.equal(res.status, 200);
    assert.equal(upsertArgs().create.authToken, "tok-é-ÿ");
  });

  it("ignores fields it does not own: a body cannot set status or id", async () => {
    const res = await post({ cpoName: "tata", authToken: "t", status: "REVOKED", id: "evil-id", createdAt: "2000-01-01" });
    assert.equal(res.status, 200);
    const { create, update } = upsertArgs();
    assert.equal(create.status, "ACTIVE");
    assert.equal(update.status, "ACTIVE");
    assert.ok(!JSON.stringify(calls).includes("evil-id"));
  });

  it("the response never echoes the secrets it was given", async () => {
    setDbResult("cpoCredential.upsert", { id: "cred-9", authToken: "RAW-TOKEN-9", refreshToken: "RAW-REFRESH-9" });
    const res = await post({
      cpoName: "tata",
      authToken: "RAW-TOKEN-9",
      refreshToken: "RAW-REFRESH-9",
      headers: { Authorization: "Bearer HDR-9" },
      cookies: { sid: "COOKIE-9" },
    });
    const text = await res.text();
    assert.equal(res.status, 200);
    for (const secret of ["RAW-TOKEN-9", "RAW-REFRESH-9", "HDR-9", "COOKIE-9"]) assert.ok(!text.includes(secret), secret);
  });
});

// ---------------------------------------------------------------------------------------------
describe("POST: a database error logs only its code or name, never the submitted values", () => {
  const SECRETS = ["ECHOME-SECRET-TOK", "ECHOME-SECRET-REF", "ECHOME-SECRET-HDR", "ECHOME-SECRET-COOKIE"];
  const submit = () =>
    post({
      cpoName: "tata",
      authToken: "ECHOME-SECRET-TOK",
      refreshToken: "ECHOME-SECRET-REF",
      headers: { Authorization: "Bearer ECHOME-SECRET-HDR" },
      cookies: { sid: "ECHOME-SECRET-COOKIE" },
    });

  async function assertGeneric500AndNoSecretsLogged(res: Response) {
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.deepEqual(Object.keys(JSON.parse(text)), ["error"]);
    const everything = text + "\n" + logged.join("\n");
    for (const secret of SECRETS) assert.ok(!everything.includes(secret), `${secret} leaked into the response or the logs`);
  }

  it("logs the Prisma code of a coded error, not its message or stack", async () => {
    failDb(
      Object.assign(new Error('Unique constraint failed on the fields: (`authToken`) value "ECHOME-SECRET-TOK"'), {
        code: "P2002",
        meta: { target: ["authToken"], value: "ECHOME-SECRET-TOK" },
      }),
    );
    await assertGeneric500AndNoSecretsLogged(await submit());
    assert.ok(logged.some((l) => l.includes("P2002")), "the error code should still reach the server log");
    assert.ok(!logged.join("\n").includes("Unique constraint failed"), "the error message was logged");
  });

  it("logs the name of an error without a code (a Prisma validation error prints the arguments)", async () => {
    const err = new Error('Invalid `prisma.cpoCredential.upsert()` invocation:\n{ create: { authToken: "ECHOME-SECRET-TOK", refreshToken: "ECHOME-SECRET-REF" } }');
    err.name = "PrismaClientValidationError";
    failDb(err);
    await assertGeneric500AndNoSecretsLogged(await submit());
    assert.ok(logged.some((l) => l.includes("PrismaClientValidationError")), "the error name should still reach the server log");
    assert.ok(!logged.join("\n").includes("Invalid `prisma"), "the error message was logged");
  });

  it("copes with something that is not an Error being thrown", async () => {
    for (const thrown of ["ECHOME-SECRET-TOK is the token", null, undefined, 42, { message: "ECHOME-SECRET-TOK", code: undefined }]) {
      resetDb();
      logged.length = 0;
      failDb(thrown);
      await assertGeneric500AndNoSecretsLogged(await submit());
      assert.ok(logged.length >= 1, "a failure should still be logged somehow");
    }
  });
});
