# SH ERP v2 — Deployment

Written during the production-readiness pass (2026-08-05), against the deployment architecture in "SH ERP v2 — Phase 2 Architecture.md" §13–18. Per §17.6, this document covers two distinct things: **(a) one-time setup** (provisioning every account/service/secret exactly once) and **(b) steady-state releases** (what a normal, repeated deploy looks like, and how to roll back).

**Deployment target for the first real launch: a single Hostinger VPS (KVM, root access)** — the owner's explicit choice, documented in full in [Hostinger VPS (first launch)](#hostinger-vps-first-launch) below. The originally-designed managed multi-provider topology (Vercel + Railway + Supabase + R2) is still fully documented afterward under [Alternative: managed multi-provider topology](#alternative-managed-multi-provider-topology) — it was built and verified first, remains correct, and is a reasonable path to move to later if/when a single VPS stops being enough. Nothing about the application itself differs between the two paths; only where each piece runs differs.

Several real gaps were found and fixed while writing this document, rather than merely noted as caveats — consistent with this project's standing practice. They're called out inline, and summarized in [Scope boundaries and disclosed gaps](#scope-boundaries-and-disclosed-gaps) at the end.

---

## Hostinger VPS (first launch)

### Architecture

One VPS runs everything except file storage:

| Component | Where | Notes |
|---|---|---|
| Nginx | Native on the VPS host (not containerized) | TLS termination (Let's Encrypt via `certbot --nginx`) + reverse proxy. The only thing that ever accepts a public connection. |
| Frontend (Next.js) | Docker container, `frontend/Dockerfile`, bound to `127.0.0.1:3001` | `output: 'standalone'` (`frontend/next.config.mjs`) — real infra necessity added during this pass, not a new app feature; without it this image would need the full `node_modules` tree at runtime instead of Next's minimal traced output. |
| Backend API (NestJS) | Docker container, `backend/Dockerfile`, bound to `127.0.0.1:3000` | Same image as the Railway path — no code differences between deployment targets. |
| Database (Postgres 16) | Docker container (`docker-compose.prod.yml`), bound to `127.0.0.1:5432` | Self-hosted, not managed — see [`app_user`/`postgres` role split](#app_userpostgres-role-split-self-hosted-postgres) below for why this needs one more setup step than the Supabase path did. |
| File storage | Cloudflare R2 (unchanged) | S3-compatible, reachable over plain HTTPS from anywhere — a VPS has no dependency-of-provider issue here, no reason to move off R2 for this path. |
| Background jobs / Redis | **Not deployed** (unchanged) | Same standing gap as the managed path — ADR-0005 accepted, not built. |

Postgres, backend, and frontend are **never exposed on the VPS's public interface** — all three are bound to `127.0.0.1` in `docker-compose.prod.yml`, so Nginx (and only Nginx) is reachable from outside.

### One-time setup

1. **DNS**: point two A records at the VPS's public IP — `app.<your-domain>` (frontend) and `api.<your-domain>` (backend). Two subdomains, not one domain with path-based routing, matching the same conceptual split the managed path already has (Vercel domain vs Railway domain) — keeps the two Nginx site configs simple and independent.
2. **System setup**: `ops/hostinger-setup.sh` — read it first, then run as root on the VPS. Installs Docker Engine + Compose plugin, Nginx, certbot, and configures `ufw` to allow only SSH/HTTP/HTTPS.
3. **Clone this repo** onto the VPS (e.g. `/opt/sh-erp`).
4. **Create `.env.prod`** in the repo root (never committed) — see the [env-var checklist](#6-full-environment-variable-checklist) below; the Hostinger path needs a few variables the managed path didn't (`POSTGRES_SUPERUSER_PASSWORD`, `APP_USER_PASSWORD`, and subdomain-based `FRONTEND_URL`/`NEXT_PUBLIC_API_BASE_URL`).
5. **Bring the stack up**:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
   ```
6. **Create the `app_user` role and grant it schema-create rights** (see the next section for why this step exists and didn't on the Supabase path):
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d sh_erp -c \
     "CREATE ROLE app_user LOGIN PASSWORD '${APP_USER_PASSWORD}';"
   docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d sh_erp -c \
     "GRANT CREATE, USAGE ON SCHEMA public TO app_user;"
   ```
7. **Apply migrations**, run as the Postgres superuser connection (not `app_user` — see the role-split section):
   ```bash
   docker compose -f docker-compose.prod.yml run --rm \
     -e DATABASE_URL="postgresql://postgres:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/sh_erp?schema=public" \
     backend npx prisma migrate deploy --schema=/app/prisma/schema.prisma
   ```
8. **Verify `app_user` really is unprivileged** (the single easiest thing to get wrong under deployment pressure, repeated a third time in this document because it's that important):
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "\du app_user"
   ```
   Confirm `Superuser`, `Create role`, and `Bypass RLS` all read no.
9. **Rotate the `auth_service` role's placeholder password** (the migration ships `changeme-rotate-before-production`):
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c \
     "ALTER ROLE auth_service PASSWORD '<a real generated password, matching AUTH_DATABASE_URL in .env.prod>';"
   ```
10. **Nginx + TLS**: copy `ops/nginx/api.conf.template` and `ops/nginx/app.conf.template` to `/etc/nginx/sites-available/`, replacing `API_DOMAIN`/`APP_DOMAIN` with the real subdomains, symlink both into `sites-enabled/`, `nginx -t`, `systemctl reload nginx`, then:
    ```bash
    certbot --nginx -d api.<your-domain> -d app.<your-domain>
    ```
    (certbot's `--nginx` plugin rewrites both site files in place to add the HTTPS server block + HTTP→HTTPS redirect — this is expected, not a manual step you also need to do.)
11. **Verify**: `curl https://api.<your-domain>/health` returns `{"status":"ok",...}`, and `https://app.<your-domain>` loads the login page.

### `app_user`/`postgres` role split (self-hosted Postgres)

On the Supabase path, provisioning the least-privilege `app_user` role happens through Supabase's own dashboard/role system, largely out of this document's hands. Self-hosting Postgres means doing that provisioning explicitly — and it surfaced a real, previously-undocumented requirement worth being precise about:

- **Postgres 15+ revokes `CREATE` on the `public` schema from `PUBLIC` by default** (a real Postgres security change, not a Supabase or SH-ERP-specific quirk). A freshly created non-superuser role has **no** ability to `CREATE TABLE` in a database it didn't create — step 6's `GRANT CREATE, USAGE ON SCHEMA public TO app_user` is what makes `prisma migrate deploy` able to actually create tables as `app_user`... except it doesn't run as `app_user` either, for the next reason.
- **`20260804000000_create_auth_service_role`'s migration runs a real `CREATE ROLE`**, which requires `CREATEROLE` privilege. Granting `app_user` `CREATEROLE` would be a real, meaningful privilege expansion — a role that can create other roles — that has nothing to do with its actual job (serving app runtime queries). Instead, migrations run as the Postgres bootstrap superuser (step 7's explicit `DATABASE_URL` override), and `app_user`'s own `DATABASE_URL` in `.env.prod` — used only by the running `backend`/`frontend` containers, never for migrations — stays exactly as unprivileged as the existing "must not be superuser, must not have BYPASSRLS" requirement already demanded, now also explicitly "must not have CREATEROLE."
- This still works correctly with RLS: `app_user` runs `prisma migrate deploy` — no, wait, the superuser does, per the point above — but if `app_user` had run it instead (an equally valid alternative if it were granted `CREATEROLE` for just that operation), it would still be RLS-safe, because table *owners* only bypass RLS on their own tables unless `FORCE ROW LEVEL SECURITY` is set — which `20260805000000_enable_rls_and_check_constraints` already does on every tenant-scoped table. The two-role split adopted here is about privilege minimalism (why should the everyday runtime role be able to create other Postgres roles at all?), not about an RLS gap that would otherwise exist.

### Steady-state releases

```bash
git pull
ops/deploy.sh
```

`ops/deploy.sh` rebuilds both images, rolls the stack forward, waits for the backend healthcheck to pass, and prunes old images. It deliberately does **not** run migrations automatically — a schema migration is a deliberate, reviewed step (same policy as every other environment: run it by hand, immediately before a deploy that needs it, using the same superuser-`DATABASE_URL`-override command from setup step 7).

There is no CI-triggered automatic deploy for this path — unlike Railway/Vercel's native Git integration, a VPS has no equivalent "push to `main` and it just happens." `ops/deploy.sh` is run over SSH by hand (or wired into a GitHub Actions SSH-deploy workflow later — a disclosed, real, not-yet-built increment, same category as the managed path's missing `deploy-staging.yml`/`deploy-production.yml`).

**Rollback**: `git checkout <previous-good-commit>` then `ops/deploy.sh` — rebuilds and redeploys the previous known-good code. The [migration rollback policy](#rollback-policy-stated-as-explicit-policy-not-left-to-judgment-under-pressure) below (roll forward with a corrective migration, never revert a migration in place) applies identically here.

### Backups on this path

See `docs/backup-restore.md` — self-hosted Postgres has no Supabase-style managed point-in-time recovery, so the backup strategy (and the RPO/RTO numbers that come with it) had to be designed for real rather than inherited from a managed provider's own guarantee.

### Disclosed gaps specific to this path

- **Single point of failure.** One VPS runs Postgres, the backend, and the frontend — there is no redundancy or automatic failover if that VPS goes down, unlike Supabase/Railway/Vercel's own managed HA. Acceptable at first-launch scale (the same framing Phase 2 §21 already uses for "not yet automated failover" on the managed path), but a real step down worth stating plainly rather than implying the two paths are equally resilient.
- **No automated CI-triggered deploy** — `ops/deploy.sh` is run by hand over SSH. `ci.yml`'s test/lint/typecheck/migration-drift gate still applies before merging to `main`; what's missing is the "and then it automatically ships" half.
- **No managed backup/PITR** — addressed for real in `docs/backup-restore.md`, not glossed over here.

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
| `DATABASE_URL` | Supabase connection string (direct, port 5432), `app_user` | All environments |
| `AUTH_DATABASE_URL` | Supabase connection string, `auth_service` role | All environments (falls back to `DATABASE_URL` if unset, which fails under real RLS — never leave unset in production) |
| `JWT_ACCESS_SECRET` | Generated secret (e.g. `openssl rand -base64 32`) | All environments |
| `JWT_ACCESS_TTL` | Fixed value (`15m`) | All environments |
| `JWT_REFRESH_TTL_DAYS` | Fixed value (`30`) | All environments — **read by both backend and frontend** (`frontend/lib/auth/server-cookies.ts` uses it to set the refresh-token cookie's own expiry; must match the backend's value or the cookie and the token it holds silently drift out of sync — real gap found during the pre-launch audit, previously undocumented in `frontend/.env.example`) |
| `PORT` | Railway sets this automatically; `3000` locally | All environments |
| `NODE_ENV` | `production` on Railway, `development` locally | All environments |
| `FRONTEND_URL` | The real Vercel origin(s), comma-separated | All deployed environments (see [CORS](#5-cors-real-gap-found-and-fixed-during-this-pass)) |
| `AI_MODEL_ALIAS` | Fixed value (`gemini-flash-latest`) | All environments |
| `AI_PLATFORM_API_KEY` | Google AI Studio / Vertex key, platform-owned | All environments where the AI module is used without every company bringing their own key |
| `AI_API_KEY_ENCRYPTION_SECRET` | Generated secret | All environments where any company sets a BYOK key |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` | Real SMTP provider credentials | Production (fails open — logs instead of sending — if unset, so staging/local can leave these blank) |
| `R2_ENDPOINT`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET` | Cloudflare R2 dashboard | All environments (file features are unusable without these — see [R2 setup](#2-cloudflare-r2-file-storage)) |
| `NEXT_PUBLIC_API_BASE_URL` (frontend) | The real Railway API URL, including `/api/v1` | All environments |
| `INTERNAL_API_BASE_URL` (frontend) | Same as above, or an internal/private URL in production | All environments — **on the Hostinger VPS path, set this to `http://backend:3000/api/v1`** (the `backend` service's Docker Compose network name), not the public `https://api.<domain>/...` URL — `frontend` and `backend` share a Docker network in `docker-compose.prod.yml`, so this avoids an unnecessary round trip out through Nginx and back in for every server-side call the Next-owned auth routes make. `NEXT_PUBLIC_API_BASE_URL` still must be the real public URL, since that one is used by the browser directly. |

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

`frontend/Dockerfile` (used only by the Hostinger VPS path — Vercel builds the frontend natively, this image doesn't exist for that path) follows the same repo-root-build-context convention, even though it has no cross-directory schema dependency of its own — kept consistent so both images are always built the same way, from the same place: `docker build -f frontend/Dockerfile -t sh-erp-web .`. Its runtime stage relies on Next.js's `output: 'standalone'` (`frontend/next.config.mjs`), which needs `public/` and `.next/static/` copied in by hand (Next's own documented standalone-output convention — those two directories are deliberately not included in the traced runtime output) — both copies are explicit steps in the Dockerfile, not omitted.

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
