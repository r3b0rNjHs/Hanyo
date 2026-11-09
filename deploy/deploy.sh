#!/usr/bin/env bash
# Build and (re)start Hanyo. Runs as `deploy` on the VPS — from GitHub Actions or by hand.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ROOT="${WEB_ROOT:-/var/www/hanyo}"
cd "$APP_DIR"

if [ "${1:-}" != "--no-pull" ]; then
  git fetch origin main
  git reset --hard origin/main
fi

npm ci --no-audit --no-fund
npm run build

# Publish the PWA atomically-ish: copy then swap old files out.
rsync -a --delete apps/web/build/ "$WEB_ROOT/"

if pm2 describe hanyo-api >/dev/null 2>&1; then
  pm2 restart hanyo-api --update-env
fi

# Keep extensions current (no-op when Suwayomi isn't up yet).
SUWAYOMI_URL=http://127.0.0.1:4567 timeout 120 bash deploy/bootstrap-extensions.sh >/dev/null 2>&1 || true
echo "Hanyo deployed: $(git rev-parse --short HEAD)"
