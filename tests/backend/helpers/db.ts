/**
 * T1-03 (ADR-0011): a real Postgres for integration tests. See README.md.
 *
 * Import this BEFORE any app module that imports src/lib/db.ts: that file reads DATABASE_URL at
 * import time, so this module points DATABASE_URL at TEST_DATABASE_URL here (only when it is set
 * and passes the guard).
 *
 *   import { dbSkip, setupTestDb, resetDb, closeTestDb } from "./helpers/db";
 *   describe("x", { skip: dbSkip }, () => { before(setupTestDb); beforeEach(resetDb); after(closeTestDb); ... });
 */
import { execFileSync } from "node:child_process";
import pg from "pg";

/** Throws unless the URL's database name contains "test". Pure; needs no database. */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL");
  }
  if (!/test/i.test(name)) {
    throw new Error(`refusing to use database "${name}": the database name must contain "test"`);
  }
  return url;
}

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
/** Pass as `{ skip: dbSkip }`: a string (reported as skipped) when there is no test database, else false. */
export const dbSkip: string | false = TEST_DATABASE_URL
  ? false
  : "TEST_DATABASE_URL is not set: needs a real Postgres (see tests/backend/helpers/README.md)";

if (TEST_DATABASE_URL) {
  assertTestDatabaseUrl(TEST_DATABASE_URL);
  process.env.DATABASE_URL = TEST_DATABASE_URL; // the app's Prisma client and pg pools now hit the test DB
}

let migrated = false;
let pool: pg.Pool | undefined;

/** `prisma migrate deploy` against TEST_DATABASE_URL, once per process. Never touches the ambient DATABASE_URL. */
export function setupTestDb(): void {
  const url = assertTestDatabaseUrl(TEST_DATABASE_URL);
  if (migrated) return;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    shell: process.platform === "win32", // npx is a .cmd on Windows
  });
  migrated = true;
}

/** The shared pool, for tests that need raw SQL. */
export function testPool(): pg.Pool {
  return (pool ??= new pg.Pool({ connectionString: assertTestDatabaseUrl(TEST_DATABASE_URL), max: 2 }));
}

/** Truncate every table in schema public except _prisma_migrations (and PostGIS's spatial_ref_sys). */
export async function resetDb(): Promise<void> {
  const p = testPool();
  const { rows } = await p.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename.replace(/"/g, '""')}"`).join(", ");
  await p.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Close the harness pool so node:test can exit. (The app's own pool is closed by whoever imported it.) */
export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
