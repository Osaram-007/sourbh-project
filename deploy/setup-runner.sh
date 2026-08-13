#!/usr/bin/env bash
# One-time bootstrap for a fresh Ubuntu EC2 instance: creates the app user,
# installs Node.js, installs the app's systemd units (not started — the
# first CI deploy populates /opt/full-charge), installs the sudoers rule for
# passwordless service restarts, and installs + registers a self-hosted
# GitHub Actions runner. After this, every push to main deploys automatically
# — no inbound port needed, the runner polls GitHub over outbound HTTPS.
#
# Get a registration token from: GitHub repo -> Settings -> Actions -> Runners
# -> New self-hosted runner (tokens are short-lived — generate one right
# before running this).
#
# Usage (as root):
#   sudo bash deploy/setup-runner.sh --repo-url https://github.com/OWNER/REPO --token <registration-token>
set -euo pipefail

REPO_URL=""
RUNNER_TOKEN=""
# Check https://github.com/actions/runner/releases for the current version —
# this only needs to be reasonably recent, the runner auto-updates itself
# after first registration.
RUNNER_VERSION="2.321.0"
NODE_MAJOR="22"
APP_USER="fullcharge"
APP_DIR="/opt/full-charge"
RUNNER_DIR="/opt/actions-runner"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url) REPO_URL="$2"; shift 2 ;;
    --token) RUNNER_TOKEN="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ -z "$REPO_URL" || -z "$RUNNER_TOKEN" ]]; then
  echo "Usage: sudo bash deploy/setup-runner.sh --repo-url <https://github.com/OWNER/REPO> --token <registration-token>"
  exit 1
fi

echo "==> Creating $APP_USER system user (home: $APP_DIR)"
id -u "$APP_USER" &>/dev/null || useradd -r -m -d "$APP_DIR" -s /bin/bash "$APP_USER"

echo "==> Installing Node.js $NODE_MAJOR.x and rsync"
if ! command -v node &>/dev/null; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
apt-get install -y rsync

echo "==> Installing sudoers rule for service restarts"
install -m 0440 "$SCRIPT_DIR/sudoers-full-charge-deploy" /etc/sudoers.d/full-charge-deploy
visudo -cf /etc/sudoers.d/full-charge-deploy

echo "==> Installing app systemd units (not started yet — first CI deploy populates $APP_DIR)"
cp "$SCRIPT_DIR/systemd/full-charge-web.service" /etc/systemd/system/
cp "$SCRIPT_DIR/systemd/full-charge-sync.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable full-charge-web full-charge-sync

echo "==> Installing GitHub Actions runner to $RUNNER_DIR"
mkdir -p "$RUNNER_DIR"
chown "$APP_USER:$APP_USER" "$RUNNER_DIR"

ARCH=$(dpkg --print-architecture)
case "$ARCH" in
  amd64) RUNNER_ARCH="x64" ;;
  arm64) RUNNER_ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

sudo -u "$APP_USER" bash -c "
  set -e
  cd '$RUNNER_DIR'
  if [ ! -f run.sh ]; then
    curl -o actions-runner.tar.gz -L \
      https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz
    tar xzf actions-runner.tar.gz
    rm actions-runner.tar.gz
  fi
  ./config.sh --url '$REPO_URL' --token '$RUNNER_TOKEN' \
    --name 'full-charge-vm' --labels 'full-charge-vm' --work '_work' \
    --unattended --replace
"

echo "==> Installing runner as a systemd service (runs as $APP_USER)"
cd "$RUNNER_DIR"
./svc.sh install "$APP_USER"
./svc.sh start

cat <<EOF

Bootstrap complete. Remaining manual steps before the first push deploys:
  1. Create $APP_DIR/.env with real (rotated) secrets — see .env.example for the keys.
  2. git push to main, or trigger the "Deploy" workflow manually from the Actions tab.
EOF
