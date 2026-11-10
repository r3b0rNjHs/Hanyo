#!/usr/bin/env bash
# One-shot provisioning of Hanyo on the existing yoqze VPS (Ubuntu 24.04).
# Run as `ubuntu` (sudo). Assumes scripts/vps-setup.sh from yoqze-agents already ran:
# user `deploy`, Node 22, PM2 and Caddy are installed.
#
#   curl -fsSL https://raw.githubusercontent.com/r3b0rNjHs/Hanyo/main/deploy/setup.sh -o setup.sh
#   bash setup.sh
set -euo pipefail

DEPLOY_USER="deploy"
APP_DIR="/home/$DEPLOY_USER/hanyo"
WEB_ROOT="/var/www/hanyo"
# HTTPS: a public repo needs no key. If the repo goes private, use the SSH URL plus a Deploy key:
#   HANYO_REPO=git@github.com:r3b0rNjHs/Hanyo.git bash setup.sh
REPO="${HANYO_REPO:-https://github.com/r3b0rNjHs/Hanyo.git}"
DOMAIN="${HANYO_DOMAIN:-hanyo.yoqze.com}"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

say "[1/8] Checking prerequisites"
id "$DEPLOY_USER" >/dev/null || { echo "User $DEPLOY_USER missing: run yoqze-agents/scripts/vps-setup.sh first"; exit 1; }
command -v node >/dev/null && command -v caddy >/dev/null || { echo "Node/Caddy missing"; exit 1; }
sudo -u "$DEPLOY_USER" bash -lc 'command -v pm2' >/dev/null || { echo "PM2 missing for $DEPLOY_USER"; exit 1; }

say "[2/8] Docker (for Suwayomi + FlareSolverr only)"
if ! command -v docker >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
fi

sudo apt-get install -y rsync sqlite3 >/dev/null

say "[3/8] Cloning repository"
sudo -u "$DEPLOY_USER" bash -c 'mkdir -p ~/.ssh && ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null; sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts'
# /home/deploy is private to `deploy` (mode 750): every check inside it runs through sudo.
if ! sudo test -d "$APP_DIR/.git"; then
  if ! sudo -u "$DEPLOY_USER" git clone "$REPO" "$APP_DIR"; then
    echo
    echo "Clone failed. If the repo is private, add this key as a read-only Deploy Key in"
    echo "GitHub → r3b0rNjHs/Hanyo → Settings → Deploy keys, then re-run with the SSH URL:"
    echo "  HANYO_REPO=git@github.com:r3b0rNjHs/Hanyo.git bash setup.sh"
    sudo cat "/home/$DEPLOY_USER/.ssh/id_ed25519.pub"
    exit 1
  fi
fi

say "[4/8] Secrets (.env)"
if ! sudo test -f "$APP_DIR/.env"; then
  HANYO_PASSWORD=""
  while [ -z "$HANYO_PASSWORD" ]; do
    read -r -s -p "Choose the Hanyo app password (not shown while typing): " HANYO_PASSWORD; echo
    [ -z "$HANYO_PASSWORD" ] && echo "The password can't be empty: the app is reachable from the internet."
  done
  SESSION_SECRET=$(openssl rand -hex 32)
  VAPID=$(sudo -u "$DEPLOY_USER" -H bash -c 'cd ~ && npx --yes web-push@3 generate-vapid-keys --json')
  VAPID_PUBLIC=$(echo "$VAPID" | sed -E 's/.*"publicKey":"([^"]+)".*/\1/')
  VAPID_PRIVATE=$(echo "$VAPID" | sed -E 's/.*"privateKey":"([^"]+)".*/\1/')
  sudo -u "$DEPLOY_USER" tee "$APP_DIR/.env" >/dev/null <<ENV
API_PORT=3101
HANYO_PASSWORD=$HANYO_PASSWORD
SESSION_SECRET=$SESSION_SECRET
IMAGE_CACHE_MAX_MB=15000
IMAGE_QUALITY=90
SUWAYOMI_URL=http://127.0.0.1:4567
SUWAYOMI_SOURCES=
UPDATE_INTERVAL_MIN=180
VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
VAPID_SUBJECT=mailto:admin@yoqze.com
ENV
  sudo chmod 600 "$APP_DIR/.env"
fi

say "[5/8] Building"
sudo mkdir -p "$WEB_ROOT" && sudo chown "$DEPLOY_USER:$DEPLOY_USER" "$WEB_ROOT"
# deploy.sh first syncs the checkout to origin/main, so re-running setup also picks up fixes.
sudo -u "$DEPLOY_USER" bash -lc "cd $APP_DIR && mkdir -p logs data && bash deploy/deploy.sh"

say "[6/8] Suwayomi + FlareSolverr"
sudo docker compose --project-directory "$APP_DIR/deploy" -f "$APP_DIR/deploy/docker-compose.yml" up -d
sudo -u "$DEPLOY_USER" bash "$APP_DIR/deploy/bootstrap-extensions.sh"

say "[7/8] PM2"
sudo -u "$DEPLOY_USER" bash -lc "cd $APP_DIR && (pm2 describe hanyo-api >/dev/null 2>&1 && pm2 restart hanyo-api --update-env || pm2 start deploy/ecosystem.config.cjs) && pm2 save"

say "[8/8] Caddy ($DOMAIN)"
sudo mkdir -p /etc/caddy/sites-enabled
sudo sed "s/hanyo.yoqze.com/$DOMAIN/" "$APP_DIR/deploy/hanyo.caddy" | sudo tee /etc/caddy/sites-enabled/hanyo.caddy.new >/dev/null
# Validate on a copy first: the live Caddyfile (with the yoqze auth hashes) only changes if valid.
# Created by root: Ubuntu's fs.protected_regular stops root from writing to another user's file in /tmp.
CANDIDATE=$(sudo mktemp)
sudo cp /etc/caddy/Caddyfile "$CANDIDATE"
if ! sudo grep -q "sites-enabled" "$CANDIDATE"; then
  printf '\n# Extra sites (hanyo, ...)\nimport /etc/caddy/sites-enabled/*.caddy\n' | sudo tee -a "$CANDIDATE" >/dev/null
fi
sudo mv /etc/caddy/sites-enabled/hanyo.caddy.new /etc/caddy/sites-enabled/hanyo.caddy
if ! sudo caddy validate --config "$CANDIDATE" --adapter caddyfile; then
  sudo rm -f /etc/caddy/sites-enabled/hanyo.caddy
  echo "Caddy config invalid; nothing changed."; exit 1
fi
sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
sudo install -m 644 "$CANDIDATE" /etc/caddy/Caddyfile
sudo rm -f "$CANDIDATE"
sudo systemctl reload caddy

# Daily SQLite backup (03:30 UTC, 7 days)
CRON="30 3 * * * sqlite3 $APP_DIR/data/hanyo.db \".backup '$APP_DIR/data/backups/hanyo-\$(date +\\%F).db'\" && find $APP_DIR/data/backups -name 'hanyo-*.db' -mtime +7 -delete"
sudo -u "$DEPLOY_USER" bash -c "mkdir -p $APP_DIR/data/backups; (crontab -l 2>/dev/null | grep -v 'hanyo.db'; echo \"$CRON\") | crontab -"

# -4: DNS needs the IPv4 for the A record (ifconfig.me prefers IPv6 when available).
IP=$(curl -4 -s --max-time 10 ifconfig.me || echo "<VPS_IPv4>")
RESOLVED=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')
if [ "$RESOLVED" = "$IP" ]; then
  DNS_STEP="1. DNS: $DOMAIN already points to $IP. Nothing to do."
else
  DNS_STEP="1. DNS (IONOS → yoqze.com → DNS): add an A record   hanyo → $IP
   Caddy gets the HTTPS certificate automatically once it resolves."
fi
cat <<DONE

=== Hanyo installed ===
$DNS_STEP
2. Open https://$DOMAIN on the iPhone in Safari, log in, then Share → Add to Home Screen.
3. For auto-deploys, add the GitHub Actions secrets VPS_HOST, VPS_USER, VPS_SSH_KEY
   and the variable DEPLOY_ENABLED=true to r3b0rNjHs/Hanyo (same secrets as yoqze-agents).
DONE
