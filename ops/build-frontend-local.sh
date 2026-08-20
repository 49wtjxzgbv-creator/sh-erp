#!/usr/bin/env bash
# Builds the frontend OFF the production VPS — locally, or any machine with
# real CPU/RAM — then ships the finished `.next/standalone` bundle there via
# rsync. Exists because of real, repeated `next build` flakiness running
# directly on the VPS (see next.config.mjs's own comment + ops/deploy.sh's
# git history): that box is a single shared vCPU, plenty to RUN the app but
# not to reliably survive static-page generation. Checked against
# Hostinger's own usage graphs (2026-08-20): real day-to-day CPU there stays
# under ~25% outside of a build — the box isn't undersized for the app, only
# for the build — so paying for a permanently bigger VPS to survive a
# five-minute build window isn't worth it. Building elsewhere and shipping
# the artifact is free and removes the flakiness at its source.
#
# Run from the repo root, on a machine with the repo checked out and
# `ssh root@<vps>` access configured:
#
#   ./ops/build-frontend-local.sh
#
# Then run ops/deploy.sh ON the VPS as usual — it now only builds the
# backend and restarts both services; the frontend standalone build this
# script ships is already sitting there waiting for it.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VPS_HOST="${VPS_HOST:-root@186.240.149.205}"
REMOTE_FRONTEND_ENV=/etc/sh-erp/frontend.env
REMOTE_FRONTEND_DIR=/opt/sh-erp/frontend

TMP_ENV="$(mktemp)"
trap 'rm -f "$TMP_ENV"' EXIT

echo "=== 1. Fetching production frontend env from $VPS_HOST (build-time NEXT_PUBLIC_* values must match exactly, or the shipped bundle silently points at the wrong API) ==="
ssh "$VPS_HOST" "cat $REMOTE_FRONTEND_ENV" > "$TMP_ENV"

set -a
# shellcheck disable=SC1090
source "$TMP_ENV"
set +a
: "${NEXT_PUBLIC_API_BASE_URL:?NEXT_PUBLIC_API_BASE_URL is empty in the env fetched from $VPS_HOST — aborting rather than building against nothing}"
case "$NEXT_PUBLIC_API_BASE_URL" in
  */api/v1)
    ;;
  *)
    echo "ERROR: NEXT_PUBLIC_API_BASE_URL must end in exactly '/api/v1' (got: '$NEXT_PUBLIC_API_BASE_URL')." >&2
    echo "This is a REAL past incident (2026-08-05): a value ending in '/api' instead of '/api/v1' built" >&2
    echo "successfully and 404'd on every single API call in production. Fix $REMOTE_FRONTEND_ENV and re-run." >&2
    exit 1
    ;;
esac

echo "=== 2. Building frontend locally (postbuild copies static assets automatically — see frontend/scripts/copy-standalone-static.js) ==="
cd "$REPO_ROOT/frontend"
rm -rf .next
npm ci
npm run build
cd "$REPO_ROOT"

echo "=== 3. Shipping .next/standalone to $VPS_HOST:$REMOTE_FRONTEND_DIR/.next/standalone ==="
ssh "$VPS_HOST" "mkdir -p $REMOTE_FRONTEND_DIR/.next"
rsync -az --delete "$REPO_ROOT/frontend/.next/standalone/" "$VPS_HOST:$REMOTE_FRONTEND_DIR/.next/standalone/"

echo "=== Done. Now run ops/deploy.sh on the VPS (git pull first) to build the backend and restart both services. ==="
