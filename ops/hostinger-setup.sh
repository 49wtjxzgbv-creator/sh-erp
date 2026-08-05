#!/usr/bin/env bash
# One-time Hostinger VPS provisioning (docs/deployment.md's "Hostinger VPS
# (first launch)" section). Written for Ubuntu 22.04/24.04 (Hostinger's
# default VPS OS images) with root/sudo access, matching the owner's
# confirmed plan (KVM VPS, root access). Review before running — this
# installs system packages and changes firewall rules, the kind of thing
# that should be read once, not blindly executed on a box you care about.
#
# Idempotent where practical (apt/docker installs are already
# idempotent by nature; ufw rules use `--force` only where ufw itself is
# idempotent about duplicate rules). NOT run automatically by anything else
# in this repo — a human runs this once, by hand, on the target VPS.
#
# Usage: ssh onto the VPS, then:
#   curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/ops/hostinger-setup.sh -o hostinger-setup.sh
#   less hostinger-setup.sh   # actually read it first
#   sudo bash hostinger-setup.sh
# or simply clone the repo first and run it from there.

set -euo pipefail

echo "=== SH ERP — Hostinger VPS one-time setup ==="

echo "--- apt update/upgrade ---"
apt-get update -y
apt-get upgrade -y

echo "--- Docker Engine + Compose plugin (official convenience script, per docs.docker.com) ---"
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
else
  echo "Docker already installed, skipping."
fi
docker --version
docker compose version

echo "--- Nginx + certbot (TLS termination happens on the HOST, not in a container — see docs/deployment.md for why) ---"
apt-get install -y nginx certbot python3-certbot-nginx

echo "--- Firewall (ufw): allow SSH, HTTP, HTTPS only ---"
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status verbose

echo "--- Postgres/backend/frontend ports (5432/3000/3001) intentionally NOT opened ---"
echo "docker-compose.prod.yml binds all three to 127.0.0.1 only — Nginx is the sole public entrypoint."

echo "--- AWS CLI (used by ops/backup-postgres.sh to push backups to R2 — R2's S3-compatible API works with the standard AWS CLI, no separate tool needed) ---"
apt-get install -y awscli
aws --version

echo ""
echo "=== System-level setup complete. Remaining steps are documented in docs/deployment.md: ==="
echo "  1. Clone this repo onto the VPS (or scp it over)."
echo "  2. Create .env.prod from the env-var checklist in docs/deployment.md (never commit it)."
echo "  3. Copy ops/nginx/*.conf.template to /etc/nginx/sites-available/, filling in your real domains,"
echo "     symlink into sites-enabled/, nginx -t, systemctl reload nginx."
echo "  4. Run: certbot --nginx -d app.<your-domain> -d api.<your-domain>"
echo "  5. docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build"
echo "  6. Run the one-time role setup + migrations (docs/deployment.md's exact SQL/commands)."
echo "  7. Verify: curl https://api.<your-domain>/health"
echo "  8. Schedule ops/backup-postgres.sh in cron — see docs/backup-restore.md."
