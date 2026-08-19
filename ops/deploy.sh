#!/usr/bin/env bash
# ONE script, the whole deploy, no manual commands — per the explicit
# production-readiness requirement this rewrite exists to satisfy. Run from
# the repo root ON THE VPS, after `git pull`:
#
#   ./ops/deploy.sh
#
# What it does, in order: loads env centrally (fixes the exact
# "DATABASE_URL not visible to prisma db seed" incident this rewrite was
# triggered by — see docs/deployment.md's "post-mortem" section), backend
# npm install + prisma generate + migrate deploy + db seed + build,
# frontend npm install + build (which self-copies its own static assets —
# see frontend/scripts/copy-standalone-static.js), restarts both systemd
# services, then verifies the whole stack is actually healthy before
# declaring success. Any failure at any step aborts the script (set -e) —
# this deliberately does NOT try to leave a half-deployed state running.
#
# Real architecture change (2026-08-05 audit): backend/frontend used to be
# Docker containers here. That's retired in favor of native systemd
# services (ops/systemd/*.service) — see docker-compose.prod.yml's own
# header comment for why. Postgres stays in Docker; everything else in this
# script is now plain npm/node on the host.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BACKEND_ENV=/etc/sh-erp/backend.env
FRONTEND_ENV=/etc/sh-erp/frontend.env

echo "=== 0. Sanity checks ==="
for f in "$BACKEND_ENV" "$FRONTEND_ENV"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: $f not found. See docs/deployment.md's env-var checklist — copy backend/.env.example / " >&2
    echo "frontend/.env.example there, fill in real values, chmod 640, chown root:shserp." >&2
    exit 1
  fi
done

echo "=== 1. Postgres up (Docker — see docker-compose.prod.yml's header comment for why only this stays containerized) ==="
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres
echo "Waiting for Postgres to accept connections..."
for i in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U "${POSTGRES_SUPERUSER:-postgres}" -d sh_erp >/dev/null 2>&1; then
    echo "Postgres ready."
    break
  fi
  [ "$i" -eq 30 ] && { echo "ERROR: Postgres never became ready." >&2; exit 1; }
  sleep 2
done

echo "=== 2. Loading backend env centrally (this IS the fix for the real 'DATABASE_URL empty' incident — everything below inherits this same environment, nothing is re-exported by hand in a different shell) ==="
set -a
# shellcheck disable=SC1090
source "$BACKEND_ENV"
set +a
: "${DATABASE_URL:?DATABASE_URL is empty in $BACKEND_ENV — aborting rather than seeding/migrating against nothing}"

if [ -z "${SUPER_ADMIN_JWT_SECRET:-}" ]; then
  echo "WARNING: SUPER_ADMIN_JWT_SECRET is empty in $BACKEND_ENV — SuperAdminGuard fails closed without it," >&2
  echo "so the Super Admin panel will reject every request until this is set. This does NOT block the" >&2
  echo "rest of the app (regular company login/API is unaffected), so the deploy continues." >&2
fi
if [ -z "${SUPER_ADMIN_BOOTSTRAP_EMAIL:-}" ] || [ -z "${SUPER_ADMIN_BOOTSTRAP_PASSWORD:-}" ]; then
  echo "NOTE: SUPER_ADMIN_BOOTSTRAP_EMAIL/PASSWORD not both set in $BACKEND_ENV — seed will skip creating" >&2
  echo "the first Super Admin account (safe no-op). Set both before the next deploy if you need one." >&2
fi

echo "=== 3. Backend: install, generate, migrate, seed, build ==="
cd "$REPO_ROOT/backend"
# Full install, NOT --omit=dev: `nest build` needs the TypeScript
# toolchain, and `prisma db seed`'s ts-node invocation (package.json's
# "prisma":{"seed":...}) needs ts-node — both are devDependencies. There is
# no container-image-size reason to strip them anymore now that this runs
# natively, so this no longer tries to be clever about it.
npm ci
npx prisma generate --schema=../prisma/schema.prisma

echo "--- Migrations (superuser connection — app_user intentionally lacks CREATEROLE, see .env.example) ---"
DATABASE_URL="${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is empty in $BACKEND_ENV}" \
  npx prisma migrate deploy --schema=../prisma/schema.prisma

echo "--- Seed (permissions catalogue, plan tiers, Super Admin bootstrap — idempotent, safe on every deploy) ---"
npx prisma db seed

echo "--- Build ---"
npm run build
cd "$REPO_ROOT"

echo "=== 4. Loading frontend env + validating build-time config ==="
set -a
# shellcheck disable=SC1090
source "$FRONTEND_ENV"
set +a
: "${NEXT_PUBLIC_API_BASE_URL:?NEXT_PUBLIC_API_BASE_URL is empty in $FRONTEND_ENV}"
case "$NEXT_PUBLIC_API_BASE_URL" in
  */api/v1)
    ;;
  *)
    echo "ERROR: NEXT_PUBLIC_API_BASE_URL must end in exactly '/api/v1' (got: '$NEXT_PUBLIC_API_BASE_URL')." >&2
    echo "This is a REAL past incident (2026-08-05): a value ending in '/api' instead of '/api/v1' built" >&2
    echo "successfully and 404'd on every single API call in production. Fix $FRONTEND_ENV and re-run." >&2
    exit 1
    ;;
esac

echo "=== 5. Frontend: install, build (postbuild copies static automatically — see frontend/scripts/copy-standalone-static.js) ==="
cd "$REPO_ROOT/frontend"
npm ci
# Real incident (2026-08-19): on this VPS's actual resources (1 vCPU,
# 3.8GB RAM — confirmed via `free -h`/`nproc`), `next build`'s static-page
# generation workers ran under enough memory pressure to corrupt React's
# module state mid-render, surfacing as "Cannot read properties of null
# (reading 'useContext')" on nearly every page — not a code bug (the exact
# same commit built cleanly in a less constrained environment), and it did
# NOT self-heal by clearing .next and rebuilding. Raising Node's old-space
# ceiling for just this build step (not the whole script) fixed it
# immediately on a clean rebuild.
NODE_OPTIONS='--max-old-space-size=3072' npm run build
cd "$REPO_ROOT"

echo "=== 6. Restarting services ==="
sudo systemctl restart sh-erp-backend
sudo systemctl restart sh-erp-frontend

echo "=== 7. Verifying ==="
echo "--- Waiting for backend /health ---"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo "Backend healthy."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: backend did not become healthy within 60s. Recent logs:" >&2
    journalctl -u sh-erp-backend --no-pager -n 50 >&2
    exit 1
  fi
  sleep 2
done

echo "--- Checking frontend responds ---"
if ! curl -fsS http://127.0.0.1:3001/ >/dev/null 2>&1; then
  echo "ERROR: frontend is not responding on 127.0.0.1:3001. Recent logs:" >&2
  journalctl -u sh-erp-frontend --no-pager -n 50 >&2
  exit 1
fi

echo "--- Confirming both systemd units report active ---"
systemctl is-active --quiet sh-erp-backend || { echo "ERROR: sh-erp-backend is not active." >&2; exit 1; }
systemctl is-active --quiet sh-erp-frontend || { echo "ERROR: sh-erp-frontend is not active." >&2; exit 1; }

echo "=== Deploy complete. No manual steps remain. ==="
