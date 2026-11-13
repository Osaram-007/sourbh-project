/**
 * Recording fake of the Prisma client for the T0-04 route tests. Not a test file (no `.test.ts`).
 *
 * `src/lib/db.ts` reuses globalThis.prisma when it is set, so importing this file (before any app
 * module loads) makes every route and service use the fake. Every property access and every call
 * is recorded, so "refused before the database" and "this exact argument reached the database" are
 * checked literally. Scope: refusal and response-shape tests only, an ADR-0011 exception (see the
 * header of routeGuards.test.ts). It does not check queries against a schema.
 */
import { CANARY } from "./authTestKit";

/** Every `db.<model>` access and `<model>.<method>` call, in order. Empty means the DB was never touched. */
export const touched: string[] = [];
/** Every model method call with the arguments it received. */
export const calls: Array<{ op: string; args: unknown[] }> = [];

let failure: { err: unknown } | null = null;
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

/** Clear the log, the canned results and any forced failure. */
export function resetDb(): void {
  touched.length = 0;
  calls.length = 0;
  failure = null;
  results = {};
}

/** What `<model>.<method>` resolves to, e.g. setDbResult("cpoCredential.findMany", rows). */
export function setDbResult(key: string, value: unknown): void {
  results[key] = value;
}

/**
 * Every model method call throws `err` from now on. It may be anything, including undefined or a
 * non-Error; call with no argument to throw an Error carrying CANARY.
 */
export function failDb(...err: [unknown?]): void {
  failure = { err: err.length ? err[0] : new Error(CANARY) };
}

/** The arguments of every call to `op` (e.g. "favorite.create"). */
export function callsTo(op: string): unknown[][] {
  return calls.filter((c) => c.op === op).map((c) => c.args);
}

export const fakeDb: object = new Proxy(
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
            return async (...args: unknown[]) => {
              const op = `${model}.${method}`;
              touched.push(op);
              calls.push({ op, args });
              if (failure) throw failure.err;
              return op in results ? results[op] : (DEFAULT_RESULT[method] ?? null);
            };
          },
        },
      );
    },
  },
);
(globalThis as unknown as { prisma: object }).prisma = fakeDb;
