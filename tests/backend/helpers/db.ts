/**
 * T1-03 (ADR-0011): a real Postgres for integration tests. See README.md.
 *
 * One database PER TEST PROCESS: `<base>_<pid>`, created from TEST_DATABASE_URL (the shared base DB,
 * which is never truncated or dropped here). `npm test` runs files in parallel, so a shared DB
 * would let one file's resetDb() delete another's fixtures.
 *
 * Import this BEFORE any app module that imports src/lib/db.ts: that file reads DATABASE_URL at
 * import time, so this module points DATABASE_URL at the per-process DB here. When TEST_DATABASE_URL
 * is unset, DATABASE_URL is pinned to a closed port (as authTestKit.ts does), so a test that forgot
 * `{ skip: dbSkip }` can never reach a real database.
 *
 *   import { dbSkip, setupTestDb, resetDb, closeTestDb } from "./helpers/db";
 *   describe("x", { skip: dbSkip }, () => { before(setupTestDb); beforeEach(resetDb); after(closeTestDb); ... });
 */
import { execSync } from "node:child_process";
import pg from "pg";

const TEST_TOKEN = /(^|[_-])test([_-]|$)/i;

function dbName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL");
  }
}

function assertTestName(name: string): void {
  if (!TEST_TOKEN.test(name)) {
    throw new Error(`refusing to use database "${name}": the database name must contain a "test" token (e.g. fullcharge_test)`);
  }
}

/** Throws unless the URL's database name has a `test` token and no `schema` param. Pure; needs no database. */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  assertTestName(dbName(url));
  if (new URL(url).searchParams.has("schema")) {
    throw new Error('TEST_DATABASE_URL must not have a "schema" parameter: the harness only supports schema public');
  }
  return url;
}

/** The per-process database for a base URL: same server and credentials, name `<base>_<pid>`. Guards both names. */
export function perProcessDb(baseUrl: string, pid: number = process.pid): { name: string; url: string } {
  assertTestDatabaseUrl(baseUrl);
  const u = new URL(baseUrl);
  const name = `${dbName(baseUrl)}_${pid}`;
  // Postgres truncates identifiers to 63 bytes, which could drop the pid digits and collide with the base name.
  if (Buffer.byteLength(name) > 63) {
    throw new Error(`derived database name "${name}" is over 63 bytes: use a shorter TEST_DATABASE_URL database name`);
  }
  assertTestName(name);
  u.pathname = `/${encodeURIComponent(name)}`;
  return { name, url: u.toString() };
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
/** Pass as `{ skip: dbSkip }`: a string (reported as skipped) when there is no test database, else false. */
export const dbSkip: string | false = TEST_DATABASE_URL
  ? false
  : "TEST_DATABASE_URL is not set: needs a real Postgres (see tests/backend/helpers/README.md)";

const perProcess = TEST_DATABASE_URL ? perProcessDb(TEST_DATABASE_URL) : undefined; // throws on a bad name, at import
/** Name of this process's database, or undefined when there is no TEST_DATABASE_URL. */
export const testDbName = perProcess?.name;
// The app's Prisma client and pg pools now hit this process's database (or nothing at all).
process.env.DATABASE_URL = perProcess?.url ?? "postgresql://x:x@127.0.0.1:1/x_test";

let migrated = false;
let pool: pg.Pool | undefined;

async function withAdmin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: assertTestDatabaseUrl(TEST_DATABASE_URL) }); // the base DB, only to CREATE/DROP DATABASE
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Create a fresh per-process DB, `prisma migrate deploy` into it, and check the app's client points at it. Once per process. */
export async function setupTestDb(): Promise<void> {
  if (!perProcess) throw new Error("TEST_DATABASE_URL is not set");
  if (migrated) return;
  const q = quoteIdent(perProcess.name);
  await withAdmin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${q} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${q}`);
  });
  execSync("npx prisma migrate deploy", {
    // dotenv vars cleared so an inherited DOTENV_CONFIG_* cannot make .env override DATABASE_URL
    env: { ...process.env, DATABASE_URL: perProcess.url, DOTENV_CONFIG_OVERRIDE: undefined, DOTENV_CONFIG_PATH: undefined },
    stdio: "pipe",
    timeout: 60_000,
  });
  // Catches an import-order mistake: the app's pool was built from some other DATABASE_URL first.
  const { db } = await import("@/lib/db");
  const rows = await db.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`;
  if (rows[0]?.d !== perProcess.name) {
    throw new Error(`the app's db client is on "${rows[0]?.d}", not "${perProcess.name}": import helpers/db before any module that imports @/lib/db`);
  }
  migrated = true; // only after the pin check, so a failed check is not skipped by a later setupTestDb()
}

/** The per-process pool, for tests that need raw SQL. */
export function testPool(): pg.Pool {
  if (!perProcess) throw new Error("TEST_DATABASE_URL is not set");
  return (pool ??= new pg.Pool({ connectionString: perProcess.url, max: 2 }));
}

/** Truncate every table in schema public of the per-process DB, except _prisma_migrations (and PostGIS's spatial_ref_sys). */
export async function resetDb(): Promise<void> {
  const p = testPool();
  const { rows } = await p.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `public.${quoteIdent(r.tablename)}`).join(", ");
  await p.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * End the harness pool and drop the per-process DB (best effort). The FORCE drop also closes the app pool's
 * sockets. Prisma's adapter keeps an 'error' listener on the app pool while connected, so the FORCE drop's
 * 57P01 is absorbed. Do not call `db.$disconnect()` before `closeTestDb()`.
 */
export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  if (!perProcess || !migrated) return;
  try {
    await withAdmin((c) => c.query(`DROP DATABASE IF EXISTS ${quoteIdent(perProcess.name)} WITH (FORCE)`));
  } catch {
    // best effort: a leftover <base>_<pid> DB is dropped by the next setupTestDb with the same pid
  }
  migrated = false;
}
