#!/usr/bin/env bash
# Restart Cloudflare WARP (and the containers that use it) when its tunnel is down.
#
# Docker marks the warp container "unhealthy" when the tunnel drops, but `restart: unless-stopped`
# only acts when a container exits, so Suwayomi keeps failing with "SOCKS: Host unreachable".
# Run by root from cron every 5 minutes (see install-warp-watchdog.sh). Does nothing when WARP
# isn't enabled (no COMPOSE_FILE with the warp override in deploy/.env).
set -uo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG=/var/log/hanyo-warp-watchdog.log
cd "$DEPLOY_DIR" || exit 0

grep -qs "docker-compose.warp.yml" .env || exit 0

# One run at a time (a restart takes a while).
exec 9>/run/hanyo-warp-watchdog.lock
flock -n 9 || exit 0

tunnel_ok() {
  docker compose exec -T warp curl -s --max-time 10 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q '^warp=on'
}

tunnel_ok && exit 0
# A single miss can be a blip: look again before restarting anything.
sleep 30
tunnel_ok && exit 0

echo "$(date -Is) warp tunnel down, restarting warp, suwayomi, flaresolverr" >>"$LOG"
docker compose restart warp >>"$LOG" 2>&1
for _ in $(seq 1 12); do
  sleep 10
  tunnel_ok && break
done
docker compose restart suwayomi flaresolverr >>"$LOG" 2>&1
if tunnel_ok; then
  echo "$(date -Is) warp back up" >>"$LOG"
else
  echo "$(date -Is) warp still down after restart" >>"$LOG"
fi
