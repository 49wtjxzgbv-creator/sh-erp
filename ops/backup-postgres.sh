#!/usr/bin/env bash
# Daily Postgres backup for the Hostinger VPS path (docs/backup-restore.md).
# Meant to be run from cron as root (or a dedicated backup user) in the repo
# root, once a day. Takes a logical backup (`pg_dump`, custom format) of the
# self-hosted `sh_erp` database, keeps a local retention window, and
# uploads a copy off-VPS to the same Cloudflare R2 bucket this app already
# uses for file storage (R2 is S3-compatible — reuses the R2_* credentials
# already in .env.prod rather than introducing a second storage provider
# just for backups) under a `pg-backups/` prefix, distinct from the
# `tenants/...` prefix real file uploads use.
#
# Why logical `pg_dump` and not continuous WAL archiving/PITR: WAL-based
# continuous backup gives a much tighter RPO but is real operational
# complexity (a WAL archive target, replay tooling, more that can silently
# break) that isn't warranted for a first launch on a single VPS — daily
# `pg_dump` is the honest, low-complexity choice for this stage, with the
# resulting ~24h RPO stated plainly in docs/backup-restore.md rather than
# implied to be better than it is. Revisit if the business ever needs a
# tighter RPO than "up to a day."
#
# Crontab example (as root): 0 3 * * * /opt/sh-erp/ops/backup-postgres.sh >> /var/log/sh-erp-backup.log 2>&1

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.prod ]; then
  echo "ERROR: .env.prod not found in repo root." >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env.prod; set +a

BACKUP_DIR="${BACKUP_DIR:-/var/backups/sh-erp}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="${BACKUP_DIR}/sh_erp_${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

echo "=== Dumping sh_erp (${TIMESTAMP}) ==="
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U "${POSTGRES_SUPERUSER:-postgres}" -d sh_erp --format=custom --compress=9 \
  > "${DUMP_FILE}"

DUMP_SIZE=$(du -h "${DUMP_FILE}" | cut -f1)
echo "Local dump written: ${DUMP_FILE} (${DUMP_SIZE})"

echo "=== Uploading to R2 (off-VPS copy) ==="
# Requires `aws` CLI (installed by ops/hostinger-setup.sh) configured
# against R2's S3-compatible endpoint via the R2_* vars already in
# .env.prod — no separate AWS account or credential set needed.
AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 cp "${DUMP_FILE}" "s3://${R2_BUCKET}/pg-backups/sh_erp_${TIMESTAMP}.dump" \
  --endpoint-url "${R2_ENDPOINT}"

echo "=== Pruning local backups older than ${LOCAL_RETENTION_DAYS} days ==="
find "${BACKUP_DIR}" -name 'sh_erp_*.dump' -mtime "+${LOCAL_RETENTION_DAYS}" -print -delete

echo "=== Backup complete: ${DUMP_FILE} ==="
# Deliberately does NOT prune old backups in R2 — bucket lifecycle rules
# (configured once in the Cloudflare dashboard, not by this script) are the
# right place for that policy, so retention-in-the-cloud isn't silently
# tied to this script's own logic. See docs/backup-restore.md.
