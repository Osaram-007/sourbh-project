# Backend test harness (T1-03, ADR-0011)

- `db.ts`: real Postgres, one database per test process. `dbSkip`, `setupTestDb()` (creates `<base>_<pid>`, runs `prisma migrate deploy` into it, checks the app client is on it), `resetDb()` (truncates all app tables of that DB, keeps `_prisma_migrations`), `closeTestDb()` (drops it), `assertTestDatabaseUrl()`.
- `request.ts`: `makeRequest({method, path, body, cookies, headers, ip, secFetchSite})` and `routeCtx(params)`.
- `firebase.ts`: `startJwks()`/`stopJwks()`, `mintIdToken()` and negative variants. Sets `FIREBASE_JWKS_URL` and `FIREBASE_PROJECT_ID`.

## Local Postgres

```
docker run -d --name fc-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=fullcharge_test -p 127.0.0.1:5433:5432 postgres:16
```

`TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/fullcharge_test`

The database name must contain `test`; the harness throws otherwise, so a mis-set variable cannot wipe a real database. `TEST_DATABASE_URL` is only the shared base DB: each test process creates and drops its own `<name>_<pid>` database on that server, so parallel test files never see each other's rows. The base DB is never truncated or dropped, so the DB user needs `CREATEDB` (the docker `postgres` superuser has it). The name must have a `test` token (`fullcharge_test`, `fc-test-db`; not `latest`), and a `schema` query parameter is rejected. Migrations are applied for you (they need no PostGIS, so `postgres:16` is fine). Never point this at your dev `DATABASE_URL`.

```
# bash
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/fullcharge_test npm test
# PowerShell
$env:TEST_DATABASE_URL = "postgresql://postgres:test@127.0.0.1:5433/fullcharge_test"; npm test
```

Without `TEST_DATABASE_URL`, every DB test is reported as skipped (not passed). Import `helpers/db` before any module that imports `src/lib/db.ts`: it points `DATABASE_URL` at the per-process database (or, with no `TEST_DATABASE_URL`, at a closed port).

- JWKS: the verifier must read `FIREBASE_JWKS_URL` / `FIREBASE_PROJECT_ID` lazily, at first use, not at module import. Call `before(startJwks)` / `after(stopJwks)` once per file at file scope; a stop/start picks a new port.
- T0-01: `makeRequest`'s cookies and `authorization` reach the v1 wrapper's CSRF exemption, but not `requireUser()`, which still reads `next/headers`. T0-01 should pass `req` into the guards, or its tests will need `authTestKit`'s request-scope workaround.
