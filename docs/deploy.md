# Deploy runbook

Hanyo runs on the existing yoqze VPS next to the yoqze platform, without touching it:
its own PM2 process (`hanyo-api`, port 3101), its own Docker services bound to 127.0.0.1, and its own Caddy
site file imported from `/etc/caddy/Caddyfile`.

## First install (once)

1. The script clones over HTTPS, which needs no credentials while the repo is public. If the repo is
   made private: add `/home/deploy/.ssh/id_ed25519.pub` as a read-only **Deploy key** (GitHub →
   r3b0rNjHs/Hanyo → Settings → Deploy keys) and run the script with
   `HANYO_REPO=git@github.com:r3b0rNjHs/Hanyo.git`.
2. SSH in as `ubuntu` and run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/r3b0rNjHs/Hanyo/main/deploy/setup.sh -o setup.sh && bash setup.sh
   ```
   It asks for the app password, generates the session secret and push (VAPID) keys, builds, starts
   Suwayomi + FlareSolverr, installs the extensions in `deploy/extensions.txt`, starts `hanyo-api` in PM2 and
   adds the Caddy site (validated on a copy first; a timestamped backup of the old Caddyfile is kept).
3. DNS at IONOS: `A  hanyo → <VPS_IP>`. Caddy issues the certificate automatically.
4. Auto-deploy: in r3b0rNjHs/Hanyo add secrets `VPS_HOST`, `VPS_USER` (`deploy`), `VPS_SSH_KEY`
   (same as yoqze-agents) and the repository variable `DEPLOY_ENABLED=true`.

## Day to day
- Push to `main` → GitHub Actions runs `deploy/deploy.sh` on the VPS (pull, build, publish PWA, restart).
- Add a source: append its package to `deploy/extensions.txt` (names in the Keiyoushi repo) and push.
- Logs: `pm2 logs hanyo-api` · `cd ~/hanyo/deploy && sudo docker compose logs -f suwayomi`
- Upgrade Suwayomi: `cd ~/hanyo/deploy && sudo docker compose pull && sudo docker compose up -d`
- Backups: `~/hanyo/data/backups/` (daily 03:30 UTC, 7 days)

## Cloudflare WARP (sites that block the VPS IP)
Weeb Central (and others behind Cloudflare) ban OVH IPs. `deploy/docker-compose.warp.yml` adds a
`warp` container and sends all Suwayomi + FlareSolverr traffic through it (Weeb Central allows
anonymous personal use; they only asked us to pass their checks like a normal visitor).
```
cd /home/deploy/hanyo/deploy
echo 'COMPOSE_FILE=docker-compose.yml:docker-compose.warp.yml' | sudo -u deploy tee .env
sudo docker compose up -d
sudo docker compose exec warp curl -s https://cloudflare.com/cdn-cgi/trace | grep warp=   # warp=on
python3 test-sources.py warp-sources.txt   # Weeb Central + Comix
```
Then re-run `python3 test-sources.py` to confirm the 18 regular sources still work through WARP,
and add the ones from `warp-sources.txt` that pass to `extensions.txt`.
Disable: `sudo rm .env && sudo docker compose up -d --remove-orphans`.

**Watchdog.** When the WARP tunnel drops, the container turns `unhealthy` but Docker doesn't
restart it, and every Suwayomi source fails with `SOCKS: Host unreachable`. A root cron job checks
the tunnel every 5 minutes and, after two misses 30 s apart, restarts `warp`, then `suwayomi` and
`flaresolverr`:
```
sudo bash /home/deploy/hanyo/deploy/install-warp-watchdog.sh
sudo tail /var/log/hanyo-warp-watchdog.log      # restarts it made
```
It does nothing while WARP isn't enabled in `deploy/.env`.

## Resource budget (8 GB VPS)
Suwayomi ≤ 1.6 GB, FlareSolverr ≤ 1 GB, hanyo-api ≤ 512 MB, image cache ≤ 15 GB of disk.
