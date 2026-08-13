#!/usr/bin/env bash
# Deploys the current checkout to /opt/full-charge and restarts services.
# Called by .github/workflows/deploy.yml on the self-hosted runner (as the
# fullcharge user). Can also be run manually from a checkout on the VM for a
# manual/debug deploy: bash deploy/deploy.sh
set -euo pipefail

APP_DIR="/opt/full-charge"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Syncing $SRC_DIR -> $APP_DIR"
# --exclude '.env' matters: .env is never in the git checkout (gitignored),
# so without excluding it, --delete would remove the live secrets file.
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude '.next' --exclude '.env' \
  "$SRC_DIR/" "$APP_DIR/"

cd "$APP_DIR"

echo "==> Installing dependencies"
npm ci

echo "==> Applying database schema"
npx prisma generate
# No --accept-data-loss: a destructive schema change should fail the deploy
# loudly, not silently drop data on a box whose whole job is collecting it.
npx prisma db push --skip-generate

echo "==> Building"
npm run build

echo "==> Restarting services"
sudo systemctl restart full-charge-sync
sudo systemctl restart full-charge-web

sleep 5
sudo systemctl is-active --quiet full-charge-sync && echo "full-charge-sync: active" || { echo "full-charge-sync: FAILED"; exit 1; }
sudo systemctl is-active --quiet full-charge-web && echo "full-charge-web: active" || { echo "full-charge-web: FAILED"; exit 1; }

echo "==> Deploy complete"
