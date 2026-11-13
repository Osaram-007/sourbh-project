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
