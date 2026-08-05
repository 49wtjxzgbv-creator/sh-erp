#!/usr/bin/env bash
# Restore a Postgres backup for the Hostinger VPS path (docs/backup-restore.md).
# Deliberately interactive/manual, not silently automatic — a restore is a
# rare, high-stakes operation, and this script asks for explicit
# confirmation before touching the database rather than being safe to
# accidentally invoke.
#
# Usage:
#   ops/restore-postgres.sh <path-to-.dump-file>
#   ops/restore-postgres.sh --from-r2 <backup-filename>   # downloads from
#                                                          # R2 first, then restores
#
# Restores into a FRESH database (sh_erp_restore by default, override with
# RESTORE_DB_NAME) rather than overwriting `sh_erp` in place — this is
# deliberate: it lets you verify a restore's row counts/spot-checks BEFORE
# committing to cutting real traffic over to it, and it's exactly the same
# mechanism the quarterly restore drill (docs/backup-restore.md) uses.
# Promoting a verified restore to be the real `sh_erp` database (renaming
# it, or reconfiguring DATABASE_URL to point at the restored one) is a
# separate, explicit step documented in docs/backup-restore.md — not done
# automatically by this script.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.prod ]; then
  echo "ERROR: .env.prod not found in repo root." >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env.prod; set +a

RESTORE_DB_NAME="${RESTORE_DB_NAME:-sh_erp_restore}"

if [ "${1:-}" = "--from-r2" ]; then
  BACKUP_NAME="${2:?Usage: ops/restore-postgres.sh --from-r2 <backup-filename>}"
  LOCAL_PATH="/tmp/${BACKUP_NAME}"
  echo "=== Downloading ${BACKUP_NAME} from R2 ==="
  AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
    aws s3 cp "s3://${R2_BUCKET}/pg-backups/${BACKUP_NAME}" "${LOCAL_PATH}" \
    --endpoint-url "${R2_ENDPOINT}"
  DUMP_FILE="${LOCAL_PATH}"
else
  DUMP_FILE="${1:?Usage: ops/restore-postgres.sh <path-to-.dump-file>}"
fi

if [ ! -f "${DUMP_FILE}" ]; then
  echo "ERROR: ${DUMP_FILE} not found." >&2
  exit 1
fi

echo "This will create/replace database '${RESTORE_DB_NAME}' from: ${DUMP_FILE}"
echo "This does NOT touch the live 'sh_erp' database."
read -r -p "Continue? [y/N] " CONFIRM
if [ "${CONFIRM}" != "y" ] && [ "${CONFIRM}" != "Y" ]; then
  echo "Aborted."
  exit 1
fi

echo "=== Dropping and recreating ${RESTORE_DB_NAME} ==="
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  psql -U "${POSTGRES_SUPERUSER:-postgres}" -c "DROP DATABASE IF EXISTS ${RESTORE_DB_NAME};"
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  psql -U "${POSTGRES_SUPERUSER:-postgres}" -c "CREATE DATABASE ${RESTORE_DB_NAME} OWNER ${POSTGRES_SUPERUSER:-postgres};"

echo "=== Restoring dump into ${RESTORE_DB_NAME} ==="
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_restore -U "${POSTGRES_SUPERUSER:-postgres}" -d "${RESTORE_DB_NAME}" --no-owner --role="${POSTGRES_SUPERUSER:-postgres}" \
  < "${DUMP_FILE}"

echo "=== Restore complete: database '${RESTORE_DB_NAME}' ==="
echo "Next: verify it (see docs/backup-restore.md's verification checklist — row counts, spot checks)"
echo "before treating this restore as trustworthy. To actually cut real traffic over to it,"
echo "follow docs/backup-restore.md's 'Promoting a verified restore' section — not automatic."
