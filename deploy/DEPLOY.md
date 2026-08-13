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
