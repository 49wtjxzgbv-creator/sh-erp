#!/usr/bin/env bash
# One-time Hostinger VPS provisioning (docs/deployment.md's "Hostinger VPS
# (native systemd)" section). Written for Ubuntu 22.04/24.04 with root/sudo
# access. Review before running — this installs system packages, creates a
# system user, and changes firewall rules.
#
# REAL ARCHITECTURE CHANGE (2026-08-05 production-readiness audit): the
# backend/frontend used to run as Docker containers here too. That's
# retired — see docker-compose.prod.yml's own header comment for the full
# reasoning (three consecutive incidents that were all "fighting Docker,
# not fighting this app"). Only Postgres stays containerized; the app
# layer now runs as two native systemd services (ops/systemd/*.service),
# provisioned by this script.
#
# Idempotent where practical. NOT run automatically by anything else in
# this repo — a human runs this once, by hand, on the target VPS.
#
# Usage: clone the repo onto the VPS, then from its root:
#   sudo bash ops/hostinger-setup.sh

set -euo pipefail

echo "=== SH ERP — Hostinger VPS one-time setup (native systemd + Docker-for-Postgres-only) ==="

echo "--- apt update/upgrade ---"
apt-get update -y
apt-get upgrade -y

echo "--- Node.js 20 LTS (NodeSource) — runs backend/frontend natively, this is the actual app runtime now ---"
if ! command -v node &>/dev/null || [ "$(node --version | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "Node 20+ already installed, skipping."
fi
node --version
npm --version

echo "--- Docker Engine + Compose plugin (Postgres ONLY — see docker-compose.prod.yml's header comment) ---"
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
else
  echo "Docker already installed, skipping."
fi
docker --version
docker compose version

echo "--- Nginx + certbot (TLS termination happens on the HOST, not in a container) ---"
apt-get install -y nginx certbot python3-certbot-nginx

echo "--- Dedicated system user for the app services (never root, matches the least-privilege principle the old Docker USER directives were reaching for) ---"
if ! id -u shserp &>/dev/null; then
  useradd --system --create-home --home-dir /opt/sh-erp --shell /usr/sbin/nologin shserp
else
  echo "shserp user already exists, skipping."
fi

echo "--- /etc/sh-erp for the two EnvironmentFiles systemd reads (root:shserp, 0750 — real secrets, never world-readable) ---"
mkdir -p /etc/sh-erp
chown root:shserp /etc/sh-erp
chmod 750 /etc/sh-erp
echo "Populate /etc/sh-erp/backend.env and /etc/sh-erp/frontend.env from backend/.env.example and"
echo "frontend/.env.example (docs/deployment.md's env-var checklist has the full list), then:"
echo "  chown root:shserp /etc/sh-erp/*.env && chmod 640 /etc/sh-erp/*.env"

echo "--- Firewall (ufw): allow SSH, HTTP, HTTPS only ---"
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status verbose

echo "--- Postgres/backend/frontend ports (5432/3000/3001) intentionally NOT opened ---"
echo "docker-compose.prod.yml binds Postgres to 127.0.0.1 only; backend/frontend bind to 127.0.0.1 via HOST/HOSTNAME"
echo "in their own env files. Nginx is the sole public entrypoint either way."

echo "--- AWS CLI (used by ops/backup-postgres.sh to push backups to R2) ---"
apt-get install -y awscli
aws --version

echo "--- Installing systemd unit files ---"
if [ -d "$(dirname "$0")/systemd" ]; then
  cp "$(dirname "$0")/systemd/sh-erp-backend.service" /etc/systemd/system/
  cp "$(dirname "$0")/systemd/sh-erp-frontend.service" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable sh-erp-backend sh-erp-frontend
  echo "Units installed and enabled (not started yet — nothing to run until the first deploy)."
else
  echo "WARNING: ops/systemd/ not found relative to this script — copy sh-erp-backend.service and" >&2
  echo "sh-erp-frontend.service into /etc/systemd/system/ manually, then 'systemctl daemon-reload'." >&2
fi

echo ""
echo "=== System-level setup complete. Remaining steps (docs/deployment.md has the full detail): ==="
echo "  1. Clone this repo to /opt/sh-erp (chown -R shserp:shserp /opt/sh-erp) if not already there."
echo "  2. Create /etc/sh-erp/backend.env and /etc/sh-erp/frontend.env (see above), chmod 640."
echo "  3. Copy ops/nginx/*.conf.template to /etc/nginx/sites-available/, filling in your real domains,"
echo "     symlink into sites-enabled/, nginx -t, systemctl reload nginx."
echo "  4. Run: certbot --nginx -d app.<your-domain> -d api.<your-domain>"
echo "  5. Run: ./ops/deploy.sh  (the single script that does everything else — no further manual commands)"
echo "  6. Verify: curl https://api.<your-domain>/health"
echo "  7. Schedule ops/backup-postgres.sh in cron — see docs/backup-restore.md."
