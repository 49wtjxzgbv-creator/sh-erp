#!/usr/bin/env bash
# Steady-state deploy script for the Hostinger VPS path (docs/deployment.md).
# Run from the repo root ON THE VPS, after `git pull`. This is the
# self-hosted equivalent of Railway/Vercel's native-Git-integration
# auto-deploy — there is no CI-triggered remote deploy step for this path
# (see docs/deployment.md's "Scope boundaries" — a GitHub Actions SSH-deploy
# workflow is a disclosed future increment, not built for first launch).
#
# What this does NOT do, deliberately: it does not run migrations
# automatically. A schema migration is a deliberate, reviewed step (same
# "roll forward, never revert in place" policy as every other environment
# in this project) — run it by hand per docs/deployment.md when a release
# actually includes one, immediately before this script, not as a silent
# side effect of every deploy.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.prod ]; then
  echo "ERROR: .env.prod not found in repo root. See docs/deployment.md's env-var checklist." >&2
  exit 1
fi

echo "=== Building images ==="
docker compose -f docker-compose.prod.yml --env-file .env.prod build

echo "=== Rolling the stack forward (brief downtime — see docs/deployment.md's rollback policy for what to do if this goes wrong) ==="
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

echo "=== Waiting for the backend healthcheck ==="
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo "Backend healthy."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: backend did not become healthy within 30 attempts. Check: docker compose -f docker-compose.prod.yml logs backend" >&2
    exit 1
  fi
  sleep 2
done

echo "=== Pruning old, now-unused images (keeps disk usage bounded on a single small VPS) ==="
docker image prune -f

echo "=== Deploy complete. ==="
