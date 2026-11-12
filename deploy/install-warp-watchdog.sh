#!/usr/bin/env bash
# Install the WARP watchdog as a root cron job (every 5 minutes). Safe to run again.
#   sudo bash /home/deploy/hanyo/deploy/install-warp-watchdog.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo" >&2
  exit 1
fi

SCRIPT="$(cd "$(dirname "$0")" && pwd)/warp-watchdog.sh"
chmod +x "$SCRIPT"
cat >/etc/cron.d/hanyo-warp-watchdog <<EOF
# Restart WARP when its tunnel is down (see $SCRIPT).
*/5 * * * * root $SCRIPT
EOF
chmod 644 /etc/cron.d/hanyo-warp-watchdog
touch /var/log/hanyo-warp-watchdog.log
echo "Installed: /etc/cron.d/hanyo-warp-watchdog (log: /var/log/hanyo-warp-watchdog.log)"
