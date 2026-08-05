# SH ERP v2 — Production Audit & Native-Systemd Migration (2026-08-05)

Consolidated deliverable for the full production audit requested on 2026-08-05: problems found, changes made, upgrade path for an existing server, fresh-install path, the one-command deploy script, and the full ENV reference. Supersedes the "ready to deploy on Docker" framing in `docs/readiness-report.md` (2026-08-05, earlier same day) — that report predates this audit's architecture pivot away from Docker for the app layer.

## 1. Full list of problems found

**Docker build/runtime (rounds 1-4 of this audit, fixed before the architecture pivot):**

1. `PrismaService.tenant`/`runInTenantTransaction` typed as base `PrismaClient` instead of the real `$extends()`-returned type — `docker compose up --build` failed with `TS2322`.
2. `files.service.ts`'s `FileAsset.create()` call didn't satisfy Prisma's generated `XOR<...CreateInput>` type — missing explicit `companyId`.
3. Containers ran as root during `COPY --from=build`, then switched to non-root `USER nestjs` — Prisma's engine resolver couldn't write to root-owned `node_modules/@prisma/engines`, `Permission denied` at runtime.
4. `node:20-slim` has no `openssl` CLI by default — Prisma's platform detection fell back to a stale `debian-openssl-1.1.x` guess instead of the correct `3.0.x`, and the correct engine binary had no `libssl.so.3` to link against at runtime either.

**Frontend (found during this audit):**

5. Standalone Next.js build didn't ship `.next/static/`/`public/` — 404s on every CSS/JS asset in production, background/styling broken.
6. No automatic rebuild-on-env-change — changing `.env.production` silently kept serving the old build until someone remembered to rebuild by hand.
7. `NEXT_PUBLIC_API_BASE_URL` misconfigured (`/api` instead of `/api/v1`) — every API call 404'd; nothing caught this at build time.

**Backend / Prisma / environment (found during this audit):**

8. Company registration failed (`Default plan "starter" not found`) — root cause was `DATABASE_URL` existing only in an interactive shell, never visible to whatever actually invoked `prisma db seed`.
9. `prisma db seed`'s `ts-node` invocation had no reliable `ts-node`/`typescript` available in some deploy attempts (a stripped, `--omit=dev`-style install).
10. No real systemd services — backend/frontend process management was ad hoc, no `Restart=`, no dependency ordering, no centralized env.
11. `Company.status`/`CompanyStatus` (ACTIVE/SUSPENDED/OFFBOARDED) has existed in `schema.prisma` since Phase 3 but was **never read anywhere in application code** — "blocking a company" would have had zero real effect once Super Admin needed it.
12. No Super Admin role existed at all — no way to see across companies, block one, manage plan tiers post-seed, or manually create a company outside self-service signup.

**Documentation staleness (found and fixed in this final sweep):**

13. `docs/admin-guide.md`'s "Applying a new database migration" section still instructed `docker compose ... run --rm ... backend npx prisma migrate deploy` — the `backend` Compose service no longer exists. Fixed to point at `ops/deploy.sh` (with the manual-override equivalent for edge cases).
14. `docs/deployment.md`'s Hostinger section, `docs/launch-checklist.md`'s infra/database sections, and the env-var reference table all still described the old Docker-container topology and were missing every `SUPER_ADMIN_*`/`MIGRATION_DATABASE_URL`/`HOST` variable. All rewritten (see §2).
15. `ops/deploy.sh` loaded `SUPER_ADMIN_*` vars implicitly (via sourcing the whole env file) but never explicitly acknowledged them, unlike its explicit checks for `DATABASE_URL`/`NEXT_PUBLIC_API_BASE_URL`. Added an explicit (non-fatal, since Super Admin is optional) warning.

No other TODO/FIXME/HACK-style loose ends, hardcoded `localhost`/ports outside the documented fixed-port architecture, or stale Docker references were found in a full sweep of `backend/src`, `frontend/app`, `frontend/lib`, `ops/`, and `prisma/`.

## 2. Full list of changes

**Architecture pivot** — backend and frontend moved off Docker onto native systemd, Postgres stays in Docker:

- `docker-compose.prod.yml` — reduced to the `postgres` service only, with a header comment explaining why.
- `ops/systemd/sh-erp-backend.service`, `ops/systemd/sh-erp-frontend.service` (new) — `EnvironmentFile=`, `WorkingDirectory=`, `User=shserp`, `Restart=on-failure`, journal logging, `NoNewPrivileges=true`.
- `ops/deploy.sh` (rewritten) — the single command that does everything: loads env centrally, `npm ci` + `prisma generate/migrate deploy/db seed` + build for the backend, validates and builds the frontend, restarts both services, verifies health. Fails loudly and stops on any error; never leaves a half-deployed state.
- `ops/hostinger-setup.sh` (rewritten) — installs Node.js 20, Docker (Postgres only), Nginx, certbot, creates the `shserp` system user and `/etc/sh-erp`, installs the systemd units.
- `ops/nginx/*.conf.template` — comments updated to reflect systemd services instead of containers; ports unchanged.

**Docker fixes (still relevant for the Railway/managed path and for local container testing):**

- `backend/src/prisma/prisma.service.ts`, `backend/src/prisma/tenant-tx-context.ts` — `TenantPrismaClient` type via `ReturnType<typeof extendWithTenantScoping>`.
- `backend/src/modules/files/files.service.ts` — explicit `companyId` in `FileAsset.create()`.
- `backend/Dockerfile` — `chown nestjs:nodejs /app` + `--chown` on all `COPY --from=build`; `openssl` package installed in both `deps` and `runtime` stages.

**Frontend build:**

- `frontend/scripts/copy-standalone-static.js` (new), wired as `frontend/package.json`'s `postbuild` — static assets are now an inseparable part of `npm run build`, never a manual step.
- `frontend/Dockerfile` — redundant static-asset `COPY` lines removed (postbuild already handles it); no longer used by the Hostinger path.

**Super Admin (new feature, ADR-0010):**

- `prisma/schema.prisma` — `SuperAdmin`, `SuperAdminAuditLog` models.
- `prisma/migrations/20260805100000_add_super_admin/` — both tables, plus the `super_admin_service` Postgres role (`BYPASSRLS`, narrow table-level grants, verified via `pglast`).
- `backend/src/modules/super-admin/**` (new) — separate Prisma client, guard, JWT secret, audit service, and controllers for auth/companies/users/plans/audit.
- `backend/src/modules/identity/auth.service.ts`, `backend/src/common/interceptors/tenant-scope.interceptor.ts` — `Company.status` now actually enforced at login, refresh, and per-request.
- `frontend/app/super-admin/**`, `frontend/app/impersonate/page.tsx`, `frontend/lib/super-admin/**` (new) — fully separate panel, session store, and API client from the regular app.
- `prisma/seed.ts` — auto-bootstraps the first Super Admin from `SUPER_ADMIN_BOOTSTRAP_EMAIL`/`PASSWORD`, idempotent.

**Documentation** — `docs/deployment.md`, `docs/launch-checklist.md`, `docs/admin-guide.md`, `docs/backup-restore.md` rewritten for the native-systemd path; `docs/adr/0010-super-admin-role.md` (new).

## 3. Upgrading an existing (Docker-based) server — no data loss

The database itself never moves — only how the backend/frontend processes run changes. Postgres's data volume is untouched throughout.

1. **Back up first, regardless**: `ops/backup-postgres.sh` (or a manual `pg_dump`) before touching anything.
2. **Pull the new code**: `git pull` on the VPS.
3. **Run `ops/hostinger-setup.sh` again** — it's idempotent: installs Node.js 20, creates the `shserp` user and `/etc/sh-erp` if they don't exist, installs (but doesn't yet enable/start) the two systemd units. Safe to re-run on a server that already has Docker/Nginx/certbot from before.
4. **Create the two env files**, `/etc/sh-erp/backend.env` and `/etc/sh-erp/frontend.env`, using the values that used to live in the old `.env.prod` (see §6 for the full mapping — most values carry over unchanged; add the new `SUPER_ADMIN_*`, `MIGRATION_DATABASE_URL`, and `HOST=127.0.0.1` values).
5. **Stop the old Docker-based backend/frontend containers** (leave `postgres` running): `docker compose -f docker-compose.prod.yml stop backend frontend`.
6. **Trim `docker-compose.prod.yml`** to just `postgres` (already done in this repo's version — `git pull` brings this in).
7. **Run the new deploy**: `./ops/deploy.sh`. This installs dependencies, generates the Prisma client, applies any new migrations (including the Super Admin migration) against the **existing** database, seeds (idempotent — won't duplicate existing plans/permissions, only adds what's missing), builds both apps, and starts both systemd services.
8. **Verify** via the [launch checklist](./launch-checklist.md)'s smoke-test section, then remove the old containers/images once satisfied: `docker compose -f docker-compose.prod.yml rm -f backend frontend` (they're already gone from the compose file, this just clears leftover container state) and `docker image prune`.

Nothing here drops or recreates the `sh_erp` database — migrations are additive (`prisma migrate deploy`), and the seed script is idempotent by design.

## 4. Fresh Ubuntu Server install

Full step-by-step in `docs/deployment.md` → [Hostinger VPS (native systemd) → One-time setup](./deployment.md#hostinger-vps-native-systemd), steps 1-12: DNS, `ops/hostinger-setup.sh`, clone the repo, create the two env files plus a minimal `.env.prod` for Postgres, bring Postgres up, create `app_user`, run `./ops/deploy.sh`, verify `app_user`'s privileges, rotate the `auth_service`/`super_admin_service` placeholder passwords, install Nginx + TLS, final verification.

## 5. Deploy script

```bash
cd /opt/sh-erp
git pull
./ops/deploy.sh
```

One command, every time, first deploy or the hundredth. See `ops/deploy.sh` itself (heavily commented) for exactly what it does at each step, or [Steady-state releases](./deployment.md#steady-state-releases) in `docs/deployment.md`.

## 6. Full ENV variable reference

The authoritative, complete table lives in `docs/deployment.md` → [§6 Full environment variable checklist](./deployment.md#6-full-environment-variable-checklist) — not duplicated here to avoid the two copies drifting apart. New in this audit: `MIGRATION_DATABASE_URL`, `SUPER_ADMIN_DATABASE_URL`, `SUPER_ADMIN_JWT_SECRET`, `SUPER_ADMIN_JWT_TTL`, `SUPER_ADMIN_BOOTSTRAP_EMAIL`/`PASSWORD`/`FORCE_PASSWORD_RESET`, `HOST`. Everything else carries over unchanged from the pre-audit list.

## Self-verification against the requested checklist

Performed as careful static/logical verification — **this sandbox has no Docker daemon, no root/sudo, and no live Postgres**, and `binaries.prisma.sh`/`download.docker.com`/`deb.nodesource.com` are all blocked here (confirmed again this session), so nothing below was executed against a real running stack. Treat the first real `./ops/deploy.sh` run on the actual VPS as the first real test.

| Item | Verified how |
|---|---|
| Site opens, CSS works | Static: `postbuild` hook copies `.next/static`/`public` into the standalone output every build (traced through `frontend/package.json` + `copy-standalone-static.js`); Nginx `app.conf.template` proxies `/_next/*` and `/` correctly. Not run live. |
| Company registration + Starter plan auto-created | Static: `ops/deploy.sh` runs `prisma db seed` (which seeds plan tiers) as an inseparable step of every deploy, with `DATABASE_URL` guaranteed non-empty by the script's own check. Not run live. |
| Login/refresh/logout | Static: unchanged auth code paths, now additionally gated on `Company.status === 'ACTIVE'`. Covered by `backend/test/tenancy-auth.e2e-spec.ts` in CI (not re-run here). |
| User creation | Static: unchanged code path, unaffected by this audit's changes. |
| Super Admin | Static: guard fails closed without `SUPER_ADMIN_JWT_SECRET`; module registration and route wiring confirmed via a dedicated audit sweep (see §1, problems 11-12 and their fixes). Not run live. |
| No errors in logs | Cannot verify — no live process exists in this sandbox to produce logs. |
| No manual commands needed after deploy | Static: `ops/deploy.sh` traced end-to-end — install, generate, migrate, seed, build, restart, health-check are all in the one script; nothing outside it is required for a working deploy. |

This is the same disclosed limitation that has applied to every round of this audit — real, not glossed over. The static verification performed (type-checking, `pglast` SQL parsing, cross-referencing `schema.prisma` against migrations, tracing every script line by line) is substantive, but it is not the same as having actually run the stack.
