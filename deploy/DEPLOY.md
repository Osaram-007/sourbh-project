# Deploying to an AWS VM (data-collection setup)

Every push to `main` auto-deploys via a self-hosted GitHub Actions runner installed on the VM
itself. It polls GitHub over outbound HTTPS — **no inbound port has to be opened for CI**, so the
security-group lockdown below stays fully in effect. A build/typecheck gate runs on a GitHub-hosted
runner first; only if that passes does the deploy job run on the VM.

Two independent systemd units: `full-charge-web` (the Next.js UI, optional if you only care about
collection) and `full-charge-sync` (the scraper/dedupe/snapshot loop, runs every 15 minutes). They
restart independently — a web crash never interrupts data collection and vice versa.

## Manual steps first (not covered by scripts)

- **Rotate every secret** in `.env` before deploying — `DATABASE_URL`, `NEXTAUTH_SECRET`,
  `SYNC_SECRET_KEY`, `GOOGLE_CLIENT_SECRET`, `OCM_API_KEY`. The old ones are in git history on a
  public repo and must be treated as compromised.
- **Lock down the AWS security group**: restrict inbound on the app port (3000, or 443 if you put
  a reverse proxy in front) to your own IP. Nothing needs to be opened for CI/CD itself.

## One-time bootstrap

1. Get a runner registration token: repo on GitHub → **Settings → Actions → Runners → New
   self-hosted runner**. Tokens are short-lived — generate it right before the next step.
2. On the VM, with this repo available locally (e.g. `git clone <repo-url> /tmp/bootstrap && cd /tmp/bootstrap`):
   ```bash
   sudo bash deploy/setup-runner.sh --repo-url https://github.com/OWNER/REPO --token <registration-token>
   ```
   This creates the `fullcharge` system user (home `/opt/full-charge`), installs Node.js, installs
   and enables the two app systemd units (not started yet), installs the sudoers rule that lets
   `fullcharge` restart those two services without a password, and installs + registers the
   self-hosted runner as its own systemd service.
3. Create `/opt/full-charge/.env` by hand with the real, rotated secrets (see `.env.example` for
   the full key list, including `SNAPSHOT_RETENTION_DAYS`). This file is never touched by
   deploys — `deploy/deploy.sh` explicitly excludes it from the sync.
4. Push to `main`, or trigger the **Deploy** workflow manually from the Actions tab. Watch it in
   the GitHub Actions UI, or on the VM: `journalctl -u actions.runner.* -f`.
5. Confirm both services came up: `systemctl status full-charge-web full-charge-sync`, and that
   `SyncRun` rows are being written after the first sync cycle.

## What happens on every push after that

`.github/workflows/deploy.yml`:
1. **build** (GitHub-hosted): `npm ci`, `prisma generate`/`validate`, `tsc --noEmit`, `next build`.
   Fails fast without ever touching the VM.
2. **deploy** (self-hosted, on the VM): runs `deploy/deploy.sh`, which rsyncs the checkout into
   `/opt/full-charge` (excluding `.git`, `node_modules`, `.next`, `.env`), runs `npm ci`,
   `prisma generate`, `prisma db push` (no `--accept-data-loss` — a destructive schema change fails
   the deploy instead of silently dropping data), rebuilds, and restarts both services.

A manual/debug deploy from the VM itself works the same way: `cd /opt/full-charge && bash deploy/deploy.sh`.

## Nightly backups

```bash
sudo mkdir -p /var/backups/full-charge
sudo chmod +x deploy/backup.sh
```

Add to the `fullcharge` user's crontab (`sudo -u fullcharge crontab -e`):

```
0 2 * * * set -a; . /opt/full-charge/.env; set +a; /opt/full-charge/deploy/backup.sh >> /var/log/full-charge-backup.log 2>&1
```

## Disk sizing

At 15-minute snapshots and ~20k stations / ~50k connectors, expect roughly **1.1 GB/day / ~33
GB/month** of snapshot rows. Put Postgres data on its own EBS volume sized for at least 6–12
months of headroom, and set a CloudWatch disk-usage alarm at ~70%.

## T3-09: legal pages and `APP_ENV`

Set `APP_ENV=production` only at go-live, in the CI build job and the VM `.env` together: with it set, `next build` fails while `src/content/legal.ts` has a null, blank, placeholder or draft value, and a failed `next build` on the VM damages the running site's `.next`, so CI must be the place that catches it first.

## Dependency audit triage (WEB-S03, launch gate G12)

Checked 2026-10-31 with `npm audit --omit=dev`. Production-tree findings went from 17 (2 critical,
9 high, 6 moderate) to 5 (2 critical, 2 high, 1 moderate). What was fixed: `prisma`,
`@prisma/client` and `@prisma/adapter-pg` moved to `^7.10.1` (same major, removes the `hono`,
`@hono/node-server`, `valibot`, `deepmerge-ts` and `mysql2` findings), plus lockfile-only bumps of
`nanoid`, `source-map-js` and `baseline-browser-mapping`. The deploy still runs a plain `npm ci`;
`dotenv` and `tsx` (used by the sync worker) are unchanged.

What was left at WEB-S03 time, and why. **Every row below is superseded by WEB-S09 (part 2, further
down): the production audit is now 0.** The original text is kept as provenance, with the stale
verdicts struck through.

| Package | Severity | Disposition |
|---|---|---|
| `next` 16.2.9 | critical | **RESOLVED 2026-11-02 (WEB-S09): `next` 16.4.3 landed and `npm audit --omit=dev` is now 0 vulnerabilities; see part 2 below.** ~~**Open. Blocks G12 and public HTTPS (T3-U6).**~~ (WEB-S03 verdict, no longer true.) Fixed only in 16.4.1 or later (16.4.3 is latest), a minor jump across the 16.2 fork. Needs an `AGENTS.md` docs check and a user decision. Exposure today: no Server Actions, `use cache`, rewrites, i18n, custom server or `next/image` in `src/` (`next/og` has been used since WEB-B04, by `src/app/icon.tsx`, `apple-icon.tsx` and `opengraph-image.tsx`), and production is Linux (the Windows RCE does not apply). The one default surface that stays on is `/_next/image`; `public/` has been removed (WEB-B05 deleted its unused Create Next App SVGs; any file added there needs a row in `docs/asset-register.md`) and `next.config.ts` has no `remotePatterns`. ~~Interim mitigation: `images: { unoptimized: true }` in `next.config.ts` (owned by chain-proxy, not done here).~~ **No longer required as a security mitigation: the advisories are patched in 16.4.3. It was deliberately not applied in WEB-S09 because `next.config.ts` belongs to chain-proxy (WEB-S05 then WEB-S06), so whether to set it at all is decided there, not silently dropped here.** Production is owner-IP-only until T3-U6 (WDEC-2). |
| `sharp` (next's optional dep), `postcss` 8.4.31 (nested under `next`) | high | **RESOLVED 2026-11-02 (WEB-S09): installed `sharp` 0.35.5 and nested `postcss` 8.5.23 (under `next` 16.4.3); see part 2 below.** Resolved by the `next` bump: 16.4.3 pins `postcss` 8.5.23 and `sharp` `^0.35.5`. ~~Interim risk accepted: `sharp` only handles first-party files through `/_next/image`, and the nested `postcss` only processes this repo's own CSS at build time.~~ (WEB-S03 interim acceptance, no longer needed.) |
| `next-auth`, `uuid` (its dependency) | critical, moderate | **`uuid` finding RESOLVED 2026-11-02 (WEB-S09): `uuid` 8.3.2 -> 11.1.1 via `next-auth` 4.24.15, and the production audit is clean. `next-auth` itself is NOT removed yet: T0-01 still removes `next-auth` and `@next-auth/prisma-adapter` later, and that is not done.** ~~Resolved by T0-01, which removes `next-auth` and `@next-auth/prisma-adapter`. No work done here.~~ (WEB-S03 plan; the audit was cleared by the bump instead.) |

~~Re-run `npm audit --omit=dev` after the `next` bump and after T0-01; G12 passes at zero critical
and zero high.~~ Done after the `next` bump (part 2): the audit is 0, so G12 passes. Re-running it
after T0-01 is still worthwhile.

## Dependency audit triage, part 2 (WEB-S09, launch gate G12)

Checked 2026-11-02. `next` and `eslint-config-next` moved from 16.2.9 to 16.4.3 (exact pins) and
`next-auth` from 4.24.14 to `^4.24.15`. `npm audit --omit=dev` went from 5 findings (2 critical,
2 high, 1 moderate) to **0**, so G12 passes. This supersedes the `next`, `sharp`, `postcss`,
`next-auth` and `uuid` rows in the WEB-S03 table above. `next-auth` is still removed later by T0-01.
`npm ci` still works from the lockfile and the deploy command is unchanged.

Not fixed by this bump: the **top-level** `postcss` 8.5.15 is a separate copy from the nested 8.5.23
under `next`. `npm audit` (full tree) rates it **high** and lists two advisories, one high and one
moderate. The high one is GHSA-r28c-9q8g-f849, Path Traversal in Previous Source Map Auto-Loading
(`sourceMappingURL`) leading to Arbitrary `.map` File Disclosure. The moderate one is
GHSA-fxqj-rqcc-2cmp, an incomplete fix of GHSA-6g55-p6wh-862q, where an attacker-controlled
`sourceMappingURL` reads arbitrary `.map` files when `from` is unset. The affected range is
`<=8.5.22`, and npm reports `fixAvailable: true`. It is dev-only, so it does not gate G12 (which is
`--omit=dev` by definition). Exploitability is low because all the CSS it processes is first-party,
the same reasoning WEB-S03 accepted for the nested copy. `postcss.config.mjs` loads
`@tailwindcss/postcss`, which pins `postcss` to exactly 8.5.15, so this copy is the one that
processes the CSS during `npm run build` on the deploy VM, and a lockfile-only `npm audit fix` on
`postcss` alone cannot move it. The fix is moving `@tailwindcss/postcss` (installed 4.3.1, declared
`^4`, latest 4.3.3, so in-range), which is owed to whoever next owns chain-pkg (T1-02).

## WEB-B04: SEO env (APP_ORIGIN, SITE_NOINDEX)

- `APP_ORIGIN` and `SITE_NOINDEX` are both read at **build time** (`src/lib/indexing.ts`). Changing either needs a rebuild.
- Indexing is open only when `SITE_NOINDEX=0` **and** `APP_ORIGIN` is set. Otherwise robots.txt is `Disallow: /`, the sitemap is empty and every page is `noindex`.
- `APP_ORIGIN=https://<domain>` must be in the VM `/opt/full-charge/.env` before any production build, because `deploy.sh` builds on the VM. Without it, every page `og:image` and `twitter:image` points at `http://localhost:3000`.
- Staging sets `SITE_NOINDEX=1` (T3-U8). Unset is equally closed, because only `"0"` opens indexing.
- The CI build prints a `metadataBase` warning. That is expected, because the CI build is never deployed.
- Before the index flip (WEB-U04), view the source of `/` and check that `og:image` is on `https://<domain>`.

## WEB-S05: security headers and CSP

- **What ships.** `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and `X-Frame-Options: DENY` go on every route. The static CSP (`next.config.ts`) is the floor on every path except `/api/` and `/_next/` (marketing, legal, the 404, metadata routes, case variants like `/APP`, and router prefetches, which send `next-router-prefetch`). The per-request nonce CSP (`src/proxy.ts`) replaces it on `/app*`, `/account*`, `/login` and `/admin*`, with Maps origins on `/app` only and Firebase origins on `/login` only. `/login` also gets COOP `same-origin-allow-popups`.
- **`CSP_ENFORCE` is read at build time** (inlined into both `next.config.ts` and the proxy). Without `CSP_ENFORCE=1` the site sends `Content-Security-Policy-Report-Only`. Flipping it needs a rebuild: put `CSP_ENFORCE=1` in `/opt/full-charge/.env` and deploy (`deploy.sh` rebuilds); a restart alone does nothing.
- **Hard gate: do not set `CSP_ENFORCE=1` until `/app`, `/admin/*`, `/login` and `/account` render dynamically**, for example via `await connection()` in their layouts (expected with T0-01, WEB-B07 and WEB-B19). Today `/app` and `/admin/*` are prerendered, so their scripts carry no nonce and enforcing would block them. Also, navigation between CSP surfaces (marketing, /app, /login, /admin, /account) must be a full page load (plain `<a>` or `location.assign`), never `next/link`: a client-side transition keeps the old document's policy.
- **Before enforcing on production:**
  - Check `/app` on staging in report-only with a real Maps key and confirm there are no `securitypolicyviolation` events.
  - WEB-B06 confirms the Firebase origin list against a real login.
  - **`'unsafe-eval'` on `/app`:** report-only cannot show eval violations while `'unsafe-eval'` is in the policy. Do one staging build of `/app` without it, then use the map (pan, zoom, cluster click). If no `script-src` eval violations appear, drop it.
  - **`connect-src`:** watch for violations on any `*.googleapis.com` host other than `maps.googleapis.com`. Re-check when WEB-B13 adds a Map ID or `AdvancedMarkerElement`.
  - **`https://*.google.com`:** narrow it in `connect-src`, `img-src` and `frame-src` to the hosts the soak shows. The wildcard covers `script.google.com`.
  - **Fonts:** confirm the Roboto stylesheet and fonts load with no violations.
- **No report endpoint in V1**, per ADR-0016.

## T3-02: web app binds to loopback

The web unit now runs `npm run start -- -H 127.0.0.1 -p 3000`, so only processes on the VM (Caddy, an SSH tunnel) can reach it.

- `setup-runner.sh` installs the unit files at bootstrap; `deploy.sh` does not. The repo change has no effect until someone reinstalls the unit on the VM.
- **Do not reinstall it until T3-U5 is done and the site works through Caddy.** Caddy can already proxy to 127.0.0.1:3000 under the old bind, so install and verify Caddy first, then reinstall this unit. Re-running `setup-runner.sh` or bootstrapping a new VM counts as a reinstall: it takes effect at the next deploy's restart, and the deploy still reports success.
- Install: `sudo install -m 0644 /opt/full-charge/deploy/systemd/full-charge-web.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart full-charge-web`
- Verify: `sudo ss -ltnp 'sport = :3000'` must show `127.0.0.1:3000`, not `*` or `0.0.0.0`, and `curl http://127.0.0.1:3000/` from the VM must return 200.
- To undo, reinstall a unit with `ExecStart=/usr/bin/npm run start` and repeat the steps above.
- Once this unit is installed, the security-group rule that opens 3000 to the owner IP (see the start of this file) no longer reaches the app. Use Caddy or an SSH tunnel instead; T3-U6 closes 3000.
- Anything on the VM that reaches the app must use `127.0.0.1`, not `localhost`. `localhost` can resolve to `::1`, which the app no longer listens on.

## T0-04: admin allowlist (`ADMIN_EMAILS`)

Set `ADMIN_EMAILS` in `/opt/full-charge/.env` to the owner's email before this release goes out
(comma-separated for several; matching is case-insensitive). Admin access needs the DB role
`ADMIN` **and** the email on this list. The web service reads `.env` at start, so restart
`full-charge-web` after changing it.

**If `ADMIN_EMAILS` is missing or empty, nobody is admin: the owner is locked out of `/admin`.**
`/api/admin/*` and `/api/analytics/*` all return 403, so the admin pages load but show no data
and the sync and credentials controls fail. `/api/sync` is unaffected, it uses `SYNC_SECRET_KEY`.

Failure details are not sent to the admin panel or to API callers (`/api/admin/*`, `/api/sync`); read them in the service logs. Scheduled scrapes log to `full-charge-sync` (`journalctl -u full-charge-sync`), manual ones (Trigger Sync in `/admin`, `POST /api/sync`) to `full-charge-web`.

## T3-01: Caddy reverse proxy

`deploy/caddy/Caddyfile` implements ADR-0021: production is public except `/admin*`, `/api/admin*`, `/api/analytics*` and `/api/sync*`, which answer 404 to anyone but `OWNER_IP`; staging (127.0.0.1:3001) is owner-only and noindex; `www` redirects (301) to the apex. Any production request whose path contains an encoded slash (`%2F`) or encoded backslash (`%5C`) is answered 400 before the owner-only rule, because Caddy and Next would otherwise disagree about which route such a path is. No script here installs Caddy.

- **Caddy version: 2.11 or later.** The file uses `roll_interval` (2.11+); distro packages are 2.6.x and will not load it. Install from Caddy's official apt repo (steps at `https://caddyserver.com/docs/install`, "Debian, Ubuntu, Raspbian"), then check `caddy version` reports 2.11 or later before going on.
- **Install the file** at `/etc/caddy/Caddyfile`:
  1. Back up the existing file: `sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak`.
  2. `sudo install -m 0644 deploy/caddy/Caddyfile /etc/caddy/Caddyfile`.
  3. Create the log directory and file owned by the service user, so a root-run `caddy validate` cannot create it as root: `sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy && { sudo test -e /var/log/caddy/access.log || sudo install -o caddy -g caddy -m 0600 /dev/null /var/log/caddy/access.log; }`. First install only: `install` replaces the file, so re-running it would delete the live log while Caddy keeps writing to the deleted file until the next roll.
- **Supply the env placeholders** with `sudo systemctl edit caddy`, adding `[Service]` and `EnvironmentFile=/etc/caddy/caddy.env`. Create that file (root-owned, mode 0600) with `SITE_DOMAIN=`, `STAGING_DOMAIN=` and `OWNER_IP=` lines. `OWNER_IP` is an IP or CIDR, or a space-separated list (for example IPv4 plus IPv6), which must be double-quoted in the env file (`OWNER_IP="<v4> <v6>"`) because the validate command loads it with bash. Real values live only on the VM, never in the repo. DNS for the apex, `www` and staging must point at the VM, and port 80 must be reachable (see the T3-U5 state below), or certificate issuance fails.
- **Validate before any reload**, with the same env the service uses: `sudo bash -c 'set -a; . /etc/caddy/caddy.env; set +a; : "${OWNER_IP:?OWNER_IP empty}"; caddy validate --config /etc/caddy/Caddyfile'`, then `sudo systemctl reload caddy`. The `:` guard is what stops an empty `OWNER_IP`: Caddy substitutes `{$OWNER_IP}` as text, so an empty value still validates, matches nothing, and every request, the owner's included, gets 404.
- **Order with T3-02:** install Caddy and verify the site through it first (it proxies to 127.0.0.1:3000 under the old bind too). Only then reinstall the loopback web unit (T3-02 section) and repeat the checks below.
- **Security group during T3-U5 (proposal, not applied).** Issuance needs port 80 reachable, but T3-U6 opens 80/443 publicly only after the T0-01, T0-04 and T0-U2 gates. Proposed state for T3-U5: port 80 public (Caddy serves only ACME challenges and the HTTPS redirect there), port 443 owner-IP-only until T3-U6. This needs the owner's explicit OK before changing the security group; nothing here changes AWS.
- **Test the deny path before T3-U6:** temporarily set `OWNER_IP=192.0.2.1` (TEST-NET, not the owner's address) in `/etc/caddy/caddy.env`, validate, reload, and from the owner's machine check that the protected paths below return 404. Then restore the real `OWNER_IP`, validate, reload.
- **Verify.** Substitute the real domain for `example.com` below (`$SITE_DOMAIN` is not set in your shell). Non-owner checks from another network (for example a phone) only work after T3-U6 opens 443; until then use the `OWNER_IP=192.0.2.1` step above to test the deny path.
  - TLS: `curl -sI https://example.com/` returns 200 with `strict-transport-security: max-age=300`.
  - HTTP to HTTPS: `curl -sI http://example.com/` redirects to `https://`.
  - www to apex: `curl -sI https://www.example.com/x` returns 301 to `https://example.com/x`.
  - Blocked from a non-owner IP (expect 404): `/admin`, `/ADMIN`, `/api//admin/x`, `/%61dmin`, `/api/sync/`. From the owner IP, `/admin` loads.
  - Encoded slash: a request path containing `%2F` (and one containing `%5C`) returns 400, from any IP.
  - Staging: a non-owner gets 404 on every path; the owner gets the site with `x-robots-tag: noindex`.
  - Logs: `sudo tail -n1 /var/log/caddy/access.log` is JSON with no `Cookie` or `Authorization`, and a request to `/?lat=1&q=x&north=1` is logged without `lat`, `q` or `north`. The same filter applies to 5xx entries in `journalctl -u caddy`.
- **Raise HSTS after 7 stable days:** change `max-age=300` to `max-age=31536000` in `deploy/caddy/Caddyfile` in the repo (still no `includeSubDomains`, no preload), then repeat only these steps: copy the file (step 2), validate, reload. Do not repeat step 3. Do not edit `/etc/caddy/Caddyfile` on the VM only; the next reinstall would revert it.
- **Renewal check:** Caddy renews by itself, at about two-thirds of a 90-day certificate's life, so a check on day 30 shows nothing. After first issuance, `sudo journalctl -u caddy | grep -i 'certificate obtained'` shows success. Then check monthly that the expiry is always more than about 20 days away: `echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -enddate` (real domain). Ports 80 and 443 must stay reachable.
- **Log retention** is 14 days (daily roll, `roll_keep_for 336h`), provisional until Q-C10 is decided.
- **Rollback:** copy `/etc/caddy/Caddyfile.bak` back, validate, reload. To drop Caddy, `sudo systemctl disable --now caddy`. That restores direct access to port 3000 only while the web unit still has the old bind (before T3-02); after T3-02 use an SSH tunnel to 127.0.0.1:3000.

## T3-04: CI tests before deploy

- The `deploy` job runs only on `main` (`if: github.ref == 'refs/heads/main'`). A `workflow_dispatch` run on any other ref builds and tests, and never deploys.
- Pushes that change only `mobile/**` or `docs/**` do not trigger the workflow, so they do not deploy, except `docs/api-v1.md` and `docs/asset-register.md`: tests read them, so a change to either triggers a full run, including a redeploy. `workflow_dispatch` is unaffected.
- The `build` job runs `npm test` against a Postgres 16 service container (throwaway CI credentials) before `npm run build`. A failing test fails `build`, which blocks `deploy`.
- Dry-run CI on a branch: `gh workflow run deploy.yml --ref <branch>`. This builds and tests only, and only if the branch contains T3-04 (its `deploy.yml` has `if: github.ref == 'refs/heads/main'`). A dispatched run uses the workflow file from the dispatched ref.
- **Warning: never dispatch on an older branch.** Any branch cut before T3-04 merges has no `if:` gate, so dispatching it deploys that branch to production. That includes `web/design` until T3-04 merges, and the old `task/*` branches.
- Runs are serialised per ref: main uses one group (`production-deploy`, never cancelled); other refs get their own group, so a branch dry-run cannot cancel a pending main deploy. Both jobs time out at 30 minutes.
- First CI run: check the log has no "TEST_DATABASE_URL is not set" skip, and that the harness "db round trip" test passed. That run is the first real check of the T1-03 DB paths and T0-04's 6 DB tests.
