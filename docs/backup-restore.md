# SH ERP v2 — Backup & Restore

Written for the **Hostinger VPS deployment path** (`docs/deployment.md`) — self-hosted Postgres has no managed point-in-time recovery, so this document (and the two real scripts it's built around, `ops/backup-postgres.sh`/`ops/restore-postgres.sh`) is where that guarantee has to come from instead. Extends "SH ERP v2 — Phase 2 Architecture.md" §21's backup/DR framing with numbers that are honest for this specific topology, rather than inherited from the originally-designed Supabase-managed-Postgres numbers, which no longer apply once Postgres is self-hosted.

## What needs backing up, and what doesn't

| Data | Backed up how | Why |
|---|---|---|
| Postgres (`sh_erp` database) | Daily `pg_dump`, `ops/backup-postgres.sh` | The source of truth for literally everything — every other piece of state either derives from it or is disposable. |
| File attachments (product photos, assembly drawings, QC photos, AI invoice uploads, branding assets) | Cloudflare R2's own durability, **+ recommend enabling R2 bucket versioning** (one-time dashboard setting) | R2 already replicates data across Cloudflare's network — this is not "no backup," it's a different, already-strong guarantee. Versioning adds protection against an accidental overwrite/delete from this app's own code, which R2's base durability doesn't protect against. |
| `.env.prod` (all secrets) | Store a copy in a password manager or secrets vault **outside the VPS**, updated whenever a value changes | Not something `pg_dump` covers, and losing the VPS without a copy of this file means every credential must be rotated from scratch even if the database restores perfectly. |
| Application code | Git (already backed up by virtue of existing on GitHub/wherever the repo is hosted) | Nothing VPS-specific needed here — `git clone` onto a replacement VPS is the "restore." |
| Docker images | Not backed up separately | Rebuilt from source (`ops/deploy.sh`) on any replacement VPS — there's no built state worth preserving independently of the code that produces it. |

## Backup strategy: daily logical dump, not continuous WAL archiving

`ops/backup-postgres.sh` runs `pg_dump` (custom format, compressed) against the self-hosted Postgres container once a day, keeps a local retention window (7 days by default), and uploads a copy to the same Cloudflare R2 bucket this app already uses for file storage — under a `pg-backups/` prefix, reusing the R2 credentials already in `.env.prod` rather than provisioning a second storage provider just for backups.

**This is a deliberate, disclosed tradeoff, not an oversight**: continuous WAL-based archiving (true point-in-time recovery, minutes of RPO instead of up to a day) is real operational complexity — a WAL archive target, replay tooling, more moving parts that can silently break — that isn't warranted for a first launch on a single VPS. Daily logical dumps are the honest, low-complexity choice for this stage. If the business later needs a tighter RPO than "up to 24 hours," upgrading to WAL archiving (or moving the database to a managed provider with built-in PITR, as the [managed multi-provider topology](./deployment.md#alternative-managed-multi-provider-topology) already does) is the natural next step — not built now.

### Setting it up

```bash
crontab -e
# add:
0 3 * * * /opt/sh-erp/ops/backup-postgres.sh >> /var/log/sh-erp-backup.log 2>&1
```

Runs at 03:00 server time — pick an hour with low real traffic if the customer base grows large enough for `pg_dump`'s brief lock contention to matter (not a concern at first-launch scale).

## Recovery Point / Recovery Time Objectives — numbers, not vibes

A DR plan without numbers is a description, not a plan (the same framing Phase 2 §21 uses, applied honestly to this topology instead of assuming Supabase-level guarantees):

| Scenario | RPO | RTO |
|---|---|---|
| Accidental data deletion/corruption by a bug | ≤24 hours (yesterday's `pg_dump`) | ≤2 hours (restore latest backup, verify, promote — single operator, manual) |
| Full VPS loss (provider outage, disk failure, etc.) | ≤24 hours (the R2 off-VPS copy — the local copy is gone with the VPS) | ≤4 hours (provision a replacement VPS, run `ops/hostinger-setup.sh`, restore from R2, redeploy) |
| R2 bucket loss | Near-zero for file data (Cloudflare's own durability) + ≤24h for the `pg-backups/` copies stored there | Same as VPS loss above once R2 access itself is restored |
| Credential compromise | N/A | Runbook-driven rotation (below) — no code deploy needed, since every secret is an env var |

These are meaningfully worse than the managed-topology path's Supabase-PITR-based numbers (§21: ≤5 min RPO, ≤4h RTO for a DB restore) — stated plainly rather than implied to be equivalent. This is the real cost of self-hosting Postgres on a single VPS for a first launch; revisit if/when it stops being an acceptable tradeoff.

## Restore procedure

```bash
# From the latest local backup:
ops/restore-postgres.sh /var/backups/sh-erp/sh_erp_<timestamp>.dump

# Or pull the latest copy from R2 first:
ops/restore-postgres.sh --from-r2 sh_erp_<timestamp>.dump
```

This restores into a **fresh** database (`sh_erp_restore` by default) — never directly overwrites the live `sh_erp` database. That's deliberate: it lets a restore be verified before any real traffic is pointed at it, and it's the exact same mechanism the quarterly restore drill (below) uses.

### Verification checklist (run before trusting any restore)

1. **Row counts** on a handful of key tables (`companies`, `products`, `production_orders`, `customer_orders`) — compare against whatever monitoring/last-known-good numbers exist, or at minimum confirm they're non-zero and roughly plausible.
2. **Spot-check a few real rows** against what's remembered/expected — same principle the migration toolkit's own `verify.ts` uses for a fresh migration, applied here to a restore instead.
3. **RLS still works**: connect as `app_user` (not the superuser), `SET app.current_company_id` to a real company id, confirm a `SELECT` only returns that company's rows.

### Promoting a verified restore to production

Once a restore in `sh_erp_restore` is verified:

1. Stop the `backend` container (`docker compose -f docker-compose.prod.yml stop backend`) to prevent writes during the swap.
2. Rename the live database out of the way and the restored one into its place:
   ```sql
   ALTER DATABASE sh_erp RENAME TO sh_erp_before_restore_<timestamp>;
   ALTER DATABASE sh_erp_restore RENAME TO sh_erp;
   ```
3. Restart the `backend` container.
4. Keep `sh_erp_before_restore_<timestamp>` around for a few days before dropping it, in case the restore itself turns out to have been the wrong call.

## Quarterly restore drill

Per Phase 2 §21's own framing, repeated here because it's the thing that makes an untested backup meaningfully different from no backup at all: **once a quarter, actually run `ops/restore-postgres.sh` against the latest real backup**, go through the verification checklist above, and log the result — pass/fail, and how long it actually took versus the RTO targets stated above. An untested backup is treated as equivalent to no backup; this log is what makes that untrue in practice. There is no tooling in this repo that runs this automatically — it's a calendar reminder and a human running two commands, deliberately kept simple enough that skipping it has no good excuse.

## Credential rotation runbook

Every secret in this system is an environment variable in `.env.prod` — rotating any of them is an env-var change + a container restart, never a code deploy:

1. Generate the new value.
2. Update it in `.env.prod` on the VPS.
3. For a Postgres role password (`app_user`, `auth_service`): also run `ALTER ROLE <role> PASSWORD '<new value>';` against the database (`docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "..."`) — the env var alone doesn't change what Postgres itself accepts.
4. `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d` to pick up the new values (no rebuild needed for an env-only change).
5. Update the off-VPS secrets-manager/password-manager copy referenced in the table above, so it doesn't silently go stale.

**Rotate immediately, not on the next scheduled cycle, if**: a laptop with SSH access to the VPS is lost/stolen, a team member with `.env.prod` access leaves, or any secret is suspected to have leaked (accidentally committed, pasted somewhere public, etc.).

## Disaster scenarios this plan is explicitly designed for

Same framing as Phase 2 §21, restated for this topology:

- **Accidental deletion/corruption by a bug** → restore yesterday's (or today's, if the backup already ran) `pg_dump` into a fresh database, verify, promote.
- **Full loss of the VPS** → provision a replacement (`ops/hostinger-setup.sh`), restore from the R2 off-VPS copy, redeploy (`ops/deploy.sh`), repoint DNS if the IP changed.
- **R2 bucket loss** → Cloudflare's own durability makes this an unlikely scenario for file data; the `pg-backups/` copies stored there would also be gone in this scenario, so the most recent *local* `pg_dump` (up to the local retention window) becomes the fallback.
- **Compromised credentials** → the rotation runbook above, for whichever credential was compromised.

## What this plan does not (yet) cover

Stated plainly, not glossed over:

- **No automatic failover.** A VPS outage means real downtime until a human notices and executes the "full VPS loss" recovery path above — there is no standby VPS or automatic DNS failover. Acceptable at first-launch scale, same as the managed topology's own "not yet automated failover" admission (§21), and a real limitation either way.
- **No tested restore yet.** `ops/backup-postgres.sh`/`ops/restore-postgres.sh` were built and syntax-verified (`bash -n`) during this pass but have never run against a real Postgres instance, for the same standing sandbox-network-limitation reason nothing Prisma-related in this project has (see `backend/README.md`). **The first real backup and the first real restore drill are the first time these scripts will have actually executed** — budget time for that first drill to surface something this document didn't anticipate, and don't treat the existence of these scripts as equivalent to a proven backup strategy until that drill happens.
