# SH ERP v2 — Deployment

Written during the production-readiness pass (2026-08-05), against the deployment architecture in "SH ERP v2 — Phase 2 Architecture.md" §13–18. Per §17.6, this document covers two distinct things: **(a) one-time setup** (provisioning every account/service/secret exactly once) and **(b) steady-state releases** (what a normal, repeated deploy looks like, and how to roll back).

**Deployment target for the first real launch: a single Hostinger VPS (KVM, root access)** — the owner's explicit choice, documented in full in [Hostinger VPS (first launch)](#hostinger-vps-first-launch) below. The originally-designed managed multi-provider topology (Vercel + Railway + Supabase + R2) is still fully documented afterward under [Alternative: managed multi-provider topology](#alternative-managed-multi-provider-topology) — it was built and verified first, remains correct, and is a reasonable path to move to later if/when a single VPS stops being enough. Nothing about the application itself differs between the two paths; only where each piece runs differs.

Several real gaps were found and fixed while writing this document, rather than merely noted as caveats — consistent with this project's standing practice. They're called out inline, and summarized in [Scope boundaries and disclosed gaps](#scope-boundaries-and-disclosed-gaps) at the end.

---

## Hostinger VPS (native systemd)

### Architecture change (2026-08-05)

**This section replaces an earlier, fully-Docker version of this path** (backend and frontend as containers, alongside Postgres). That was retired, not iterated on again, after three consecutive real production incidents that turned out to all be "fighting Docker, not fighting this application": root-owned `node_modules` under a non-root container `USER` (needed `--chown`/`chown` fixes), `node:20-slim`'s missing OpenSSL causing Prisma to fetch the wrong engine binary (`debian-openssl-1.1.x` instead of `3.0.x`) and then fail to link it at runtime, and a standalone Next.js build that kept shipping without its own static assets because copying them was a manual step someone had to remember. None of those problems exist for a plain OS process managed by systemd — see `docker-compose.prod.yml`'s own header comment for the full reasoning. **Postgres stays in Docker** — it has no build step and none of this application's code running inside it, so it never had any of these failure modes.

### Architecture

One VPS runs everything except file storage:

| Component | Where | Notes |
|---|---|---|
| Nginx | Native on the VPS host | TLS termination (Let's Encrypt via `certbot --nginx`) + reverse proxy. The only thing that ever accepts a public connection. |
| Frontend (Next.js) | Native systemd service `sh-erp-frontend` (`ops/systemd/sh-erp-frontend.service`), bound to `127.0.0.1:3001` | Runs `.next/standalone/server.js` — `output: 'standalone'` (`frontend/next.config.mjs`) traces the runtime dependency graph; `npm run build`'s own `postbuild` hook (`frontend/scripts/copy-standalone-static.js`) copies `.next/static`/`public/` into it automatically, every build, no manual step. |
| Backend API (NestJS) | Native systemd service `sh-erp-backend` (`ops/systemd/sh-erp-backend.service`), bound to `127.0.0.1:3000` | Same source as the Railway path (which still uses `backend/Dockerfile` — unaffected by this change); just not containerized on this path anymore. |
| Database (Postgres 16) | Docker container (`docker-compose.prod.yml`), bound to `127.0.0.1:5432` | Self-hosted, not managed — see [`app_user`/`postgres` role split](#app_userpostgres-role-split-self-hosted-postgres) below for why this needs one more setup step than the Supabase path did. |
| File storage | Cloudflare R2 (unchanged) | S3-compatible, reachable over plain HTTPS from anywhere. |
| Background jobs / Redis | **Not deployed** (unchanged) | Same standing gap as the managed path — ADR-0005 accepted, not built. |

Postgres, backend, and frontend are **never exposed on the VPS's public interface**: Postgres is bound to `127.0.0.1` in `docker-compose.prod.yml`; backend/frontend bind to `127.0.0.1` via `HOST`/`HOSTNAME` in their own env files (`main.ts`'s `HOST` env var, standalone `server.js`'s own `HOSTNAME` handling) — so Nginx (and only Nginx) is reachable from outside either way.

### One-time setup

1. **DNS**: point two A records at the VPS's public IP — `app.<your-domain>` (frontend) and `api.<your-domain>` (backend).
2. **System setup**: `ops/hostinger-setup.sh` — read it first, then run as root on the VPS. Installs Node.js 20, Docker (for Postgres only), Nginx, certbot, configures `ufw`, creates the dedicated `shserp` system user and `/etc/sh-erp` directory, and installs (but does not start) the two systemd units.
3. **Clone this repo** to `/opt/sh-erp` (`chown -R shserp:shserp /opt/sh-erp`).
4. **Create the two application env files**, `/etc/sh-erp/backend.env` and `/etc/sh-erp/frontend.env`, from `backend/.env.example`/`frontend/.env.example` — see the [env-var checklist](#6-full-environment-variable-checklist) below. `chown root:shserp` + `chmod 640` both. These are read directly by systemd (`EnvironmentFile=`) — there is no `.env` file inside the repo itself in production, by design (see [ENV, centrally](#env-centrally-not-scattered-across-shells) below for why that distinction matters).
5. **Create a minimal `.env.prod`** in the repo root (never committed) — just `POSTGRES_SUPERUSER`/`POSTGRES_SUPERUSER_PASSWORD` and the R2 backup credentials `ops/backup-postgres.sh` needs. This is a DIFFERENT file from the two above — Postgres is still Docker Compose, the app layer is not.
6. **Bring Postgres up**:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres
   ```
7. **Create the `app_user` role and grant it schema-create rights** (see the role-split section below for why):
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d sh_erp -c \
     "CREATE ROLE app_user LOGIN PASSWORD '<matches DATABASE_URL in backend.env>';"
   docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d sh_erp -c \
     "GRANT CREATE, USAGE ON SCHEMA public TO app_user;"
   ```
8. **Build the frontend off-box, then run the first deploy.** The frontend is built on your workstation (or any machine with real CPU/RAM), not on the VPS — see [Frontend builds off-box](#frontend-builds-off-box-not-on-the-vps) below for why — then `ops/deploy.sh` does everything else on the VPS (install, generate, migrate, seed, build the backend, start both services, verify):
   ```bash
   ./ops/build-frontend-local.sh   # from your workstation
   ssh root@<vps> 'cd /opt/sh-erp && git pull && ./ops/deploy.sh'
   ```
9. **Verify `app_user` really is unprivileged** (the single easiest thing to get wrong under deployment pressure):
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "\du app_user"
   ```
   Confirm `Superuser`, `Create role`, and `Bypass RLS` all read no.
10. **Rotate the `auth_service` and `super_admin_service` roles' placeholder passwords** (both migrations ship `changeme-rotate-before-production`):
    ```bash
    docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c \
      "ALTER ROLE auth_service PASSWORD '<real password, matching AUTH_DATABASE_URL>';"
    docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c \
      "ALTER ROLE super_admin_service PASSWORD '<real password, matching SUPER_ADMIN_DATABASE_URL>';"
    ```
11. **Nginx + TLS**: copy `ops/nginx/api.conf.template` and `ops/nginx/app.conf.template` to `/etc/nginx/sites-available/`, replacing `API_DOMAIN`/`APP_DOMAIN` with the real subdomains, symlink both into `sites-enabled/`, `nginx -t`, `systemctl reload nginx`, then:
    ```bash
    certbot --nginx -d api.<your-domain> -d app.<your-domain>
    ```
12. **Verify**: `curl https://api.<your-domain>/health` returns `{"status":"ok",...}`, and `https://app.<your-domain>` loads the login page with CSS and background rendering correctly (the exact thing that was broken before this rewrite).

### `app_user`/`postgres` role split (self-hosted Postgres)

Unchanged in substance from the Docker-based path — only *how* migrations run changed (native `npx prisma migrate deploy` via `ops/deploy.sh`, not `docker compose run`).

- **Postgres 15+ revokes `CREATE` on the `public` schema from `PUBLIC` by default.** Step 7 above is what makes `prisma migrate deploy` able to create tables at all — but it doesn't even run as `app_user`, for the next reason.
- **`20260804000000_create_auth_service_role` and `20260805100000_add_super_admin` both run a real `CREATE ROLE`**, needing `CREATEROLE`. Granting `app_user` `CREATEROLE` would be a real, unnecessary privilege expansion. Instead, `ops/deploy.sh` runs migrations with `DATABASE_URL` overridden to `MIGRATION_DATABASE_URL` (the Postgres superuser connection, `backend/.env.example`) for exactly those two commands — `app_user`'s own connection, used by the actual running service, never sees this override.
- Table *owners* only bypass RLS on their own tables unless `FORCE ROW LEVEL SECURITY` is set — which `20260805000000_enable_rls_and_check_constraints` already does on every tenant-scoped table — so this role split is about privilege minimalism, not an RLS gap that would otherwise exist.

### ENV, centrally, not scattered across shells

**Real incident this section exists because of**: company registration failed in production with `Default plan "starter" not found — run prisma db seed before allowing signups.` Investigation found `prisma db seed` had never actually run — `DATABASE_URL` existed in an interactive SSH shell's exported environment but not in whatever context `npx prisma db seed` was actually invoked from, and `ts-node` (needed by `package.json`'s `"prisma":{"seed": "ts-node ../prisma/seed.ts"}`) wasn't reliably available either, because a prior deploy attempt had run `npm ci --omit=dev` for a smaller Docker image — a concern that doesn't even apply once this app runs natively.

The fix, structural, not a one-off `export`: **`/etc/sh-erp/backend.env` and `/etc/sh-erp/frontend.env` are the ONE place application configuration lives.** systemd's `EnvironmentFile=` (`ops/systemd/*.service`) reads them directly for the running services; `ops/deploy.sh` explicitly `source`s `backend.env` into its own shell (`set -a; source ...; set +a`) before running `npm ci`/`prisma generate`/`prisma migrate deploy`/`prisma db seed`/`npm run build` — so the exact same values the service runs with are what every one-off command during a deploy sees too. `frontend.env` is sourced too, but (since [Frontend builds off-box](#frontend-builds-off-box-not-on-the-vps)) only for a sanity check, not a build — `ops/build-frontend-local.sh` sources its own SSH-fetched copy of the same file for the actual build. There is no longer a scenario where `echo $DATABASE_URL` in some other shell is empty and that silently breaks anything, because nothing in the actual deploy path depends on an ambient shell export anymore. `ops/deploy.sh` also refuses to proceed at all if either env file is missing, or if `DATABASE_URL`/`NEXT_PUBLIC_API_BASE_URL` come out empty after loading them.

### Frontend builds off-box, not on the VPS

**Real, repeated incident (2026-08-19/20)**: `next build`'s static-page generation intermittently threw `TypeError: Cannot read properties of null (reading 'useContext')` on nearly every page when run directly on the VPS — never reproduced locally, same commit builds cleanly elsewhere. Root-cause investigation (2026-08-20) ruled out OOM (no `oom-kill` in `dmesg`/`journalctl` across 14 days uptime), cron/apt contention (one 22-second `unattended-upgrades` run overlapped at most the first of six failed attempts, not all six), and duplicate React versions (dependency tree confirmed clean, single `react@18.3.1`). It landed on a known, still-open upstream Next.js bug class (multiple unresolved `vercel/next.js` GitHub issues, no clean fix short of a major-version jump) that this VPS's single **shared** vCPU triggers more easily than a dedicated one would.

Checked against Hostinger's own usage graphs before deciding what to do about it: real day-to-day CPU load on this box (outside of a build) stays under ~25% — the VPS isn't undersized for *running* the app, only for *building* it. Paying for a permanently bigger VPS plan (roughly +450–560 грн/month) to survive a five-minute build window a few times a month wasn't worth it, so the frontend is now built off-box and shipped as a finished artifact instead:

```bash
./ops/build-frontend-local.sh   # from your workstation — builds, then rsyncs .next/standalone to the VPS
ssh root@<vps> 'cd /opt/sh-erp && git pull && ./ops/deploy.sh'
```

`ops/build-frontend-local.sh` fetches `/etc/sh-erp/frontend.env` from the VPS over SSH first (build-time `NEXT_PUBLIC_*` values must match exactly, same `/api/v1` validation as before), builds locally, then `rsync --delete`s `.next/standalone/` to `/opt/sh-erp/frontend/.next/standalone/` on the VPS. `ops/deploy.sh` no longer runs `npm ci`/`npm run build` for the frontend at all — it only checks `.next/standalone/server.js` exists before restarting `sh-erp-frontend`, and fails loudly with a pointer back to this script if it's missing (e.g. on a fresh VPS before the first build has ever been shipped).

The backend still builds directly on the VPS (`nest build` is fast and has never shown this flakiness).

### Steady-state releases

```bash
./ops/build-frontend-local.sh   # from your workstation
ssh root@<vps> 'cd /opt/sh-erp && git pull && ./ops/deploy.sh'
```

`ops/deploy.sh` loads env centrally (above), then for the backend: `npm ci`, `prisma generate`, `prisma migrate deploy` (superuser connection), `prisma db seed` (idempotent — permissions, plan tiers, Super Admin bootstrap), `npm run build`; for the frontend: verifies the standalone bundle `build-frontend-local.sh` already shipped is present; then restarts both systemd services and verifies `/health`, the frontend responding, and both units reporting `active` before declaring success.

There is no CI-triggered automatic deploy for this path — both scripts are run by hand (or wired into a GitHub Actions SSH-deploy workflow later — a disclosed, not-yet-built increment).

**Rollback**: `git checkout <previous-good-commit>` then re-run both steps above (`build-frontend-local.sh` then `deploy.sh`) — rebuilds and redeploys the previous known-good code through the exact same path. Skipping `build-frontend-local.sh` on a rollback would leave the OLD frontend bundle running against a rolled-back backend, which is wrong whenever the rollback includes frontend changes. The [migration rollback policy](#rollback-policy-stated-as-explicit-policy-not-left-to-judgment-under-pressure) below (roll forward with a corrective migration, never revert a migration in place) applies identically here.

### Backups on this path

See `docs/backup-restore.md` — unaffected by the systemd pivot, since Postgres itself is unchanged.

### Disclosed gaps specific to this path

- **Single point of failure.** One VPS runs Postgres, the backend, and the frontend — there is no redundancy or automatic failover if that VPS goes down. Acceptable at first-launch scale, a real step down from a managed provider's own HA.
- **No automated CI-triggered deploy** — `ops/deploy.sh` is run by hand over SSH.
- **No managed backup/PITR** — addressed for real in `docs/backup-restore.md`, not glossed over here.
- **Super Admin impersonation's access token currently travels through one browser-redirect query string** (`app/impersonate/page.tsx`) — visible in browser history/access logs for that single request. Accepted given the token's short TTL; a POST-based handoff is a disclosed follow-up, not silently treated as solved (see ADR-0010).
- **The Super Admin panel is a route tree in the same Next.js deployment as the regular frontend**, not a separately deployed app — satisfies the "separate panel" requirement at the routing/session/UI level, not at the infrastructure/network level.

---

## Alternative: managed multi-provider topology

The originally-designed topology (Vercel + Railway + Supabase + R2), fully documented below. Everything in this section was built and statically verified during the earlier production-readiness pass and remains correct — kept here as a real, ready-to-use alternative rather than deleted, since nothing about the application changed between the two paths, only where each piece runs.

### Topology

| Component | Provider | Notes |
|---|---|---|
| Frontend (Next.js) | Vercel | Not containerized — Vercel builds and serves it natively (§17.1). Root Directory must be set to `frontend/` (no root `package.json` exists in this repo). |
| Backend API (NestJS) | Railway | Docker-deployed from `backend/Dockerfile`. Root Directory must be the **repo root**, not `backend/` — see [Docker build context](#docker-build-context). |
| Database | Supabase (managed Postgres 16) | Row-Level Security is load-bearing here (ADR-0002) — see [`app_user` privilege requirement](#app_user-privilege-requirement). |
| File storage | Cloudflare R2 | S3-compatible, zero egress fees (ADR-0004). |
| Background jobs / Redis | **Not deployed** | ADR-0005 (BullMQ + Redis) is Accepted but not yet built — see [Scope boundaries](#scope-boundaries-and-disclosed-gaps). Nothing in this backend talks to Redis today. |

### One-time setup

#### 1. Supabase (database)

1. Create a Supabase project. Note the connection string — Supabase exposes both a direct connection (port 5432) and a pooled PgBouncer connection (port 6543); use the **direct** connection for `DATABASE_URL` (Prisma's `SET LOCAL app.current_company_id` — the RLS-activation statement every tenant-scoped query depends on, `PrismaService.runInTenantTransaction` — requires a session-scoped transaction, which PgBouncer's transaction-pooling mode breaks). Revisit pooling only if connection-count pressure becomes real; don't default to it.
2. Run the three migrations, **in this exact order** (filenames sort correctly, but the ordering matters enough to state explicitly):
   1. `prisma/migrations/20260803000000_init` — the baseline schema. **Real gap found and fixed during this pass**: no baseline migration existed at all before this — only the two migrations below existed, and both assume a fully-created schema they never actually created. Generated programmatically from `schema.prisma` (not hand-typed) to avoid the transcription-omission risk of ~48 `CREATE TABLE` statements written by hand; verified by parsing the output with a real Postgres grammar parser (242/242 statements valid) and cross-checking every one of its 85 foreign keys against a real `PRIMARY KEY`/`UNIQUE` constraint on the referenced table (all 85 matched).
   2. `prisma/migrations/20260804000000_create_auth_service_role` — creates the `auth_service` BYPASSRLS role (ADR-0009).
   3. `prisma/migrations/20260805000000_enable_rls_and_check_constraints` — RLS policies + CHECK constraints. **Real gap found and fixed during this pass**: this file originally referenced snake_case columns (`company_id`, `product_id`, …), which do not exist — `schema.prisma` has `@@map()` on every model (table names) but deliberately no `@map()` on individual fields, so Prisma's real generated columns are the exact camelCase field names, quoted (`"companyId"`, `"productId"`). As originally written, every statement in this file would have failed with "column does not exist" against a real database. Corrected to reference the real column names; verified the same way as the baseline migration (syntax-parsed, and its 42 `ENABLE ROW LEVEL SECURITY` tables cross-checked 1:1 against the 42 models in `schema.prisma` that actually carry a `companyId` field).

   In production, this is `npx prisma migrate deploy` run once against the fresh database (idempotent — safe to run again with nothing new to apply).
3. Create the `auth_service` role's real password (the migration ships a placeholder — `CREATE ROLE auth_service LOGIN PASSWORD 'changeme-rotate-before-production'` — rotate it via `ALTER ROLE auth_service PASSWORD '...'` and store the real value in Railway's secrets, not in the migration file).
4. Enable the `citext` extension if the migration's `CREATE EXTENSION IF NOT EXISTS citext` didn't have permission to (Supabase's project-owner role normally can; verify via `\dx` if `article`/`email`/`login` lookups behave unexpectedly case-sensitively).

##### `app_user` privilege requirement

Repeated because it's the single easiest thing to get wrong under deployment pressure — see ADR-0002 and "SH ERP v2 — Phase 3 Database Schema.md" §2. The role in `DATABASE_URL` must **not** be a superuser and must **not** have `BYPASSRLS`. `FORCE ROW LEVEL SECURITY` only blocks the table *owner's* connections from bypassing RLS — a superuser bypasses it regardless of `FORCE`. Supabase's default `postgres` role is a superuser; create a dedicated, non-superuser `app_user` role explicitly and grant it only what it needs (`SELECT`/`INSERT`/`UPDATE`/`DELETE` on `public`, matching the immutability `REVOKE`s the RLS migration already applies). Verify with `\du app_user` — confirm `Superuser` and `Bypass RLS` both read no — before pointing any real traffic at it. (The Hostinger VPS path has the same requirement, plus one more nuance — see [`app_user`/`postgres` role split](#app_userpostgres-role-split-self-hosted-postgres) above.)

#### 2. Cloudflare R2 (file storage)

1. Create an R2 bucket (`sh-erp-files` by default — matches `backend/.env.example`'s `R2_BUCKET`).
2. Create an R2 API token scoped to that bucket only (Object Read & Write). This produces `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`.
3. Note the account's R2 S3-compatible endpoint (`https://<account-id>.r2.cloudflarestorage.com`) for `R2_ENDPOINT`.

**Real gap found and fixed during this pass**: these four variables (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) are read at runtime by `backend/src/modules/files/r2-client.ts` but were completely absent from `backend/.env.example` — every file-upload feature (product photos, assembly drawings, QC photos, AI invoice attachments) was unusable without them, and undocumented. Added to `backend/.env.example`.

#### 3. Railway (backend API)

1. Create a Railway project, add a service pointed at this repo.
2. **Root Directory: repo root** (not `backend/`). `railway.json` (repo root) sets `build.dockerfilePath` to `backend/Dockerfile` — this only resolves correctly if Railway's build context is the repo root. See [Docker build context](#docker-build-context) for why.
3. Set every environment variable from `backend/.env.example` (full checklist below) in Railway's variable group for this service.
4. Railway reads `railway.json`'s `deploy.healthcheckPath: "/health"` automatically — no extra dashboard configuration needed, but verify the first deploy actually passes the healthcheck (Railway will otherwise keep the previous deployment live and silently fail the rollout).
5. **Real gap found and fixed during this pass**: `GET /health` did not exist before this pass — only a passing mention in a doc-comment ("e.g. login, register, health check"), despite the architecture explicitly depending on it for the Railway healthcheck and any uptime pinger. Built for real (`backend/src/modules/health/`): does a live `SELECT 1` against Postgres (not just "the process is running"), is `@Public()` so it works before auth is established, and sits outside the `/api/v1` prefix/version scheme (a healthcheck target should be a stable, unversioned path).
6. `worker` service: **not created**. ADR-0005's BullMQ worker doesn't exist yet — see [Scope boundaries](#scope-boundaries-and-disclosed-gaps).

#### 4. Vercel (frontend)

1. Create a Vercel project pointed at this repo.
2. **Root Directory: `frontend/`** — required for framework auto-detection (there's no root `package.json`). `frontend/vercel.json` (placed inside `frontend/`, not the repo root, for the same reason) makes the build command explicit rather than relying purely on auto-detection, so a Root Directory misconfiguration fails loudly instead of silently building the wrong thing.
3. Set `NEXT_PUBLIC_API_BASE_URL` and `INTERNAL_API_BASE_URL` (see checklist below) per environment (Preview vs Production point at different backend URLs if staging/production are separate Railway services).

#### 5. CORS — real gap found and fixed during this pass

`frontend/lib/api-client/http.ts` calls the backend directly from the browser for every module except the 3 Next-owned auth routes ("every other module talks to this URL straight from the browser," per that file's own header comment), using `NEXT_PUBLIC_API_BASE_URL`. Once frontend (Vercel) and backend (Railway) are on different origins, that's a genuine cross-origin request — and the backend had **no CORS configuration at all**. Every one of those calls would have been rejected by the browser in production, despite appearing to work in any same-origin/localhost-only manual testing.

Fixed in `backend/src/main.ts` via `app.enableCors(...)`, driven by a new `FRONTEND_URL` env var (comma-separated list of allowed origins). **This must be set in every deployed environment** — left unset, the backend falls back to a permissive reflect-any-origin default that's fine for local dev but wrong for a real deployment.

#### 6. Full environment variable checklist

| Variable | Where it comes from | Required in |
|---|---|---|
| `DATABASE_URL` | Supabase connection string (managed path) or `app_user`'s own connection string (Hostinger path) | All environments |
| `MIGRATION_DATABASE_URL` | Postgres superuser connection string | Hostinger path only — `ops/deploy.sh` overrides `DATABASE_URL` with this value for exactly `prisma migrate deploy`/`prisma db seed`'s `CREATE ROLE` statements, then never uses it again; the running service always uses `app_user`'s own unprivileged `DATABASE_URL`. See [role split](#app_userpostgres-role-split-self-hosted-postgres). |
| `AUTH_DATABASE_URL` | Connection string for the `auth_service` role | All environments (falls back to `DATABASE_URL` if unset, which fails under real RLS — never leave unset in production) |
| `SUPER_ADMIN_DATABASE_URL` | Connection string for the `super_admin_service` role | All environments where the Super Admin panel is used (falls back to `DATABASE_URL` if unset, same fails-under-RLS caveat as `AUTH_DATABASE_URL`) |
| `SUPER_ADMIN_JWT_SECRET` | Generated secret, **must differ from `JWT_ACCESS_SECRET`** | Required for the Super Admin panel to work at all — `SuperAdminGuard` throws (fails closed) if unset |
| `SUPER_ADMIN_JWT_TTL` | Fixed value (`30m`) | All environments using Super Admin |
| `SUPER_ADMIN_BOOTSTRAP_EMAIL`/`SUPER_ADMIN_BOOTSTRAP_PASSWORD` | Chosen by whoever operates the deployment | Set before the first `prisma db seed` run to auto-create the first Super Admin account; seed silently skips Super Admin bootstrap if either is unset (safe no-op, not an error) |
| `SUPER_ADMIN_BOOTSTRAP_FORCE_PASSWORD_RESET` | `"true"`/`"false"`, default `"false"` | Set to `"true"` for exactly one deploy to force-reset an existing bootstrap Super Admin's password from the env values above; leave `"false"` day to day so re-running seed never clobbers a password that's since been changed through the app |
| `JWT_ACCESS_SECRET` | Generated secret (e.g. `openssl rand -base64 32`) | All environments |
| `JWT_ACCESS_TTL` | Fixed value (`15m`) | All environments |
| `JWT_REFRESH_TTL_DAYS` | Fixed value (`30`) | All environments — **read by both backend and frontend** (`frontend/lib/auth/server-cookies.ts` uses it to set the refresh-token cookie's own expiry; must match the backend's value or the cookie and the token it holds silently drift out of sync — real gap found during the pre-launch audit, previously undocumented in `frontend/.env.example`) |
| `PORT` | Railway sets this automatically; `3000` locally/Hostinger | All environments |
| `HOST` | Unset (binds all interfaces) by default; `127.0.0.1` on the Hostinger path | Hostinger path — `main.ts` only passes a host to `app.listen()` if `HOST` is set, so this must be `127.0.0.1` in `/etc/sh-erp/backend.env` to keep the backend off the VPS's public interface (Nginx is the only public listener) |
| `NODE_ENV` | `production` in every deployed environment, `development` locally | All environments |
| `FRONTEND_URL` | The real Vercel origin(s) (managed path) or `https://app.<domain>` (Hostinger path), comma-separated | All deployed environments (see [CORS](#5-cors-real-gap-found-and-fixed-during-this-pass)) |
| `AI_MODEL_ALIAS` | Fixed value (`gemini-flash-latest`) | All environments |
| `AI_PLATFORM_API_KEY` | Google AI Studio / Vertex key, platform-owned | All environments where the AI module is used without every company bringing their own key |
| `AI_API_KEY_ENCRYPTION_SECRET` | Generated secret | All environments where any company sets a BYOK key |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` | Real SMTP provider credentials | Production (fails open — logs instead of sending — if unset, so staging/local can leave these blank) |
| `R2_ENDPOINT`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET` | Cloudflare R2 dashboard | All environments (file features are unusable without these — see [R2 setup](#2-cloudflare-r2-file-storage)) |
| `NEXT_PUBLIC_API_BASE_URL` (frontend) | The real public API URL, including `/api/v1` | All environments — **build-time value, baked into the frontend bundle.** On the Hostinger path, the frontend is built off-box (see [Frontend builds off-box](#frontend-builds-off-box-not-on-the-vps)) — `ops/build-frontend-local.sh` refuses to build if this doesn't end in exactly `/api/v1` (a real past incident — see the [launch checklist](./launch-checklist.md)). |
| `INTERNAL_API_BASE_URL` (frontend) | Same as above, or an internal/private URL in production | All environments — **on the Hostinger VPS path (native systemd, not Docker), set this to `http://127.0.0.1:3000/api/v1`** — the backend is a systemd service on the same host, not a separate Docker network peer, so a loopback address is what avoids the unnecessary round trip out through Nginx and back in for every server-side call the Next-owned auth routes make. `NEXT_PUBLIC_API_BASE_URL` still must be the real public URL, since that one is used by the browser directly. |

### Steady-state releases

Per §17.6: normal releases are `git push` to `main` → CI (`.github/workflows/ci.yml`) → deploy. This repo's CI workflow covers install, lint, typecheck, unit tests, an ephemeral Postgres service container, all three migrations applied via `prisma migrate deploy`, the real e2e spec (`backend/test/tenancy-auth.e2e-spec.ts`), a `prisma migrate diff --exit-code` drift check, and a Docker build smoke test — see [Scope boundaries](#scope-boundaries-and-disclosed-gaps) for what it deliberately does not yet do (push/deploy automation, a Redis service, an OpenAPI contract-diff step).

Until `deploy-staging.yml`/`deploy-production.yml` exist (see below), the actual deploy step is each provider's native Git integration: Railway and Vercel both redeploy automatically on push to `main` once their dashboard is connected to this repo, with no separate workflow file needed to trigger that part. What CI adds on top is the pre-deploy gate — a broken build, failing test, or schema drift never reaches either provider's auto-deploy in the first place.

#### Rollback policy — stated as explicit policy, not left to judgment under pressure

- **Application code**: both Railway and Vercel support instant redeploy of a previous build. Use it.
- **A bad database migration**: fix by rolling forward with a new corrective migration. **Never revert a migration in place** — reverting in place risks silent data loss for any row written under the bad migration's schema in the meantime, and breaks the append-only guarantee migrations are supposed to have. If a migration must be undone, the correction is itself a new, forward migration file.

## Docker build context

`backend/Dockerfile` is multi-stage (`deps`/`build`/`runtime`), `node:20-slim`, non-root user, and **must be built from the repo root**, not `backend/`:

```
docker build -f backend/Dockerfile -t sh-erp-api .
```

This is because `backend/package.json`'s own Prisma config (`"prisma": {"schema": "../prisma/schema.prisma"}`) points one directory above `backend/` — a `backend/`-only build context can't see the schema at all. `railway.json` and this document's Railway setup steps both encode "Root Directory: repo root" for exactly this reason.

The `deps` stage runs `npx prisma generate`, which needs real network access to `binaries.prisma.sh` at build time. **This could never be verified end-to-end in the sandbox this project was built in** (a standing, repeatedly-confirmed limitation — see `backend/README.md`) — a real CI/Railway build environment has normal internet access and is expected to reach it without issue, but the very first real deploy is the first time this step will have actually run.

`frontend/Dockerfile` still exists in the repo but is **not used by the Hostinger VPS path as of the 2026-08-05 architecture pivot** — the frontend now runs as a native systemd service built by `npm run build` directly on the VPS (see [Hostinger VPS (native systemd)](#hostinger-vps-native-systemd)), and Vercel builds the frontend natively on the managed path. `frontend/Dockerfile` is kept for local/manual container testing only. Its runtime stage relies on Next.js's `output: 'standalone'` (`frontend/next.config.mjs`); the static-asset copy is now done by `npm run build`'s own `postbuild` hook (`frontend/scripts/copy-standalone-static.js`), the same mechanism used on the Hostinger path — not a separate Docker `COPY` step, so both routes to a standalone build stay consistent.

## Local development

`docker compose up` (repo root) starts Postgres 16 and the API. See `docker-compose.yml`'s header comment for what's deliberately *not* included (Redis, Mailhog, a worker service) and why — nothing in this backend consumes them yet, and including inert services would misrepresent what local onboarding actually gives a new contributor today. Run the frontend separately (`npm run dev` inside `frontend/`, not containerized, matching production) pointed at the compose stack's API.

The `postgres` service in `docker-compose.yml` runs as a superuser role for local convenience — the opposite of the [`app_user` privilege requirement](#app_user-privilege-requirement) above. That's an accepted local-dev-only tradeoff (RLS policies are inert against this container as configured); never carry that shortcut into a real environment.

## Scope boundaries and disclosed gaps

Stated explicitly rather than left implicit, per this project's standing practice of disclosing rather than glossing over scope boundaries:

- **No `deploy-staging.yml`/`deploy-production.yml`**: §17.2 calls for these as separate GitHub Actions workflows with an explicit production approval gate. Not built in this pass — today's "deploy" is each provider's native Git integration (see [Steady-state releases](#steady-state-releases)), gated only by `ci.yml` passing. Building explicit deploy workflows with a GitHub Environment protection rule for production is the natural next increment here, not done yet.
- **No Redis, no BullMQ worker, no `deploy`-time Redis service container in CI**: ADR-0005 is Accepted but not implemented — nothing in this backend talks to Redis today (`ThrottlerModule` uses in-memory storage; `NotificationsModule`'s email sending fails open to a log line, not a queue). Any of `docker-compose.yml`, `railway.json`'s worker service, or `ci.yml`'s service containers should gain Redis the same day a real BullMQ queue lands, not before.
- **No OpenAPI contract-diff CI step**: §17.2 calls for one; no contract-diff tooling has been built in this repo.
- **No subdomain-based tenant resolution**: §17.4/§11.2 describe Vercel edge middleware resolving the tenant from `{slug}.sh-erp.com`. `Company.slug` exists in the schema for exactly this future use (its own header comment says so), but `frontend/middleware.ts` today is auth-guard middleware only (redirects unauthenticated requests to `/login`) — tenant/company selection currently happens at login (a company picker), not via subdomain. No DNS or edge-middleware wiring for subdomain routing exists yet.
- **`prisma generate`/`migrate deploy`/`migrate diff` could not be executed end-to-end during this project's development** — the sandbox this system was built in has never had network access to `binaries.prisma.sh` (repeatedly confirmed, including the `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING` workaround, still blocked). Every SQL migration file was instead verified statically: parsed against a real Postgres grammar parser (not just "looks right"), and — for the baseline and RLS migrations specifically — cross-checked programmatically against `schema.prisma` itself (table counts, FK-target constraint matching, tenant-table counts). This is real, substantive verification, but it is not the same as a migration having actually run against a live Postgres instance. **The first real deploy is the first time these commands will have actually executed** — treat it accordingly (run against a disposable/staging database first, not production, even though `migrate deploy` is designed to be safe to run repeatedly).
- **Railway `worker` service, `railway.json` worker start command**: not created, tracks the Redis/BullMQ gap above.
