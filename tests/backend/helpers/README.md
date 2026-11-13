# Backend test harness (T1-03, ADR-0011)

- `db.ts`: real Postgres. `dbSkip`, `setupTestDb()` (runs `prisma migrate deploy` once), `resetDb()` (truncates all app tables, keeps `_prisma_migrations`), `closeTestDb()`, `assertTestDatabaseUrl()`.
- `request.ts`: `makeRequest({method, path, body, cookies, headers, ip, secFetchSite})` and `routeCtx(params)`.
- `firebase.ts`: `startJwks()`/`stopJwks()`, `mintIdToken()` and negative variants. Sets `FIREBASE_JWKS_URL` and `FIREBASE_PROJECT_ID`.

## Local Postgres

```
docker run -d --name fc-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=fullcharge_test -p 127.0.0.1:5433:5432 postgres:16
```

`TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/fullcharge_test`

The database name must contain `test`; the harness throws otherwise, so a mis-set variable cannot wipe a real database. Migrations are applied for you. Never point this at your dev `DATABASE_URL`.

```
# bash
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/fullcharge_test npm test
# PowerShell
$env:TEST_DATABASE_URL = "postgresql://postgres:test@127.0.0.1:5433/fullcharge_test"; npm test
```

Without `TEST_DATABASE_URL`, every DB test is reported as skipped (not passed). Import `helpers/db` before any module that imports `src/lib/db.ts`: it points `DATABASE_URL` at the test database.
