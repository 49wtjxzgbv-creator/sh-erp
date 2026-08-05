# SH ERP v2 — Production Launch Checklist

For the first real Hostinger VPS launch. Each item links to the document that covers it in full — this checklist is the sequencing and the go/no-go gate, not a restatement of every command. Work through it in order; don't skip ahead on the assumption a later step will catch an earlier gap.

## 1. Infrastructure

- [ ] DNS: `app.<domain>` and `api.<domain>` A records point at the VPS's IP.
- [ ] `ops/hostinger-setup.sh` run and reviewed (Docker, Nginx, certbot, `ufw`, `awscli` all installed) — [deployment.md](./deployment.md#hostinger-vps-first-launch).
- [ ] Repo cloned onto the VPS, `.env.prod` created from the full [env-var checklist](./deployment.md#6-full-environment-variable-checklist) — every value real, nothing left as a `changeme`/placeholder.
- [ ] `docker-compose.prod.yml` stack up (`postgres`, `backend`, `frontend`), all three confirmed bound to `127.0.0.1` only (`docker compose -f docker-compose.prod.yml ps` — no `0.0.0.0` port bindings).
- [ ] Nginx site configs installed from `ops/nginx/*.conf.template`, `nginx -t` passes, reloaded.
- [ ] `certbot --nginx -d api.<domain> -d app.<domain>` succeeded — both domains serve valid HTTPS (`curl -vI https://api.<domain>/health` shows a real cert, not self-signed).

## 2. Database

- [ ] `app_user` role created, granted `CREATE, USAGE` on schema `public` only — [role-split rationale](./deployment.md#app_userpostgres-role-split-self-hosted-postgres).
- [ ] All three migrations applied in order, via the superuser connection (`20260803000000_init`, `20260804000000_create_auth_service_role`, `20260805000000_enable_rls_and_check_constraints`).
- [ ] **`\du app_user` confirms `Superuser`, `Create role`, and `Bypass RLS` all read no.** This is the single most important line item in this entire checklist — RLS silently does nothing if this is wrong, and it's the kind of mistake that's invisible until it isn't.
- [ ] `auth_service` role's placeholder password rotated to a real generated value, matching `AUTH_DATABASE_URL` in `.env.prod`.
- [ ] `citext` extension confirmed active (`\dx` inside the `postgres` container) — needed for case-insensitive `article`/`email`/`login` lookups.

## 3. Application configuration

- [ ] `FRONTEND_URL` in `.env.prod` set to the real `https://app.<domain>` — not left unset (CORS falls back to a permissive reflect-any-origin default otherwise, wrong for production).
- [ ] `NEXT_PUBLIC_API_BASE_URL` baked into the frontend build (a **build-time** arg, not just a runtime env var — confirm `docker compose -f docker-compose.prod.yml build frontend` was run with the real value, not the Dockerfile's `localhost` default).
- [ ] `JWT_ACCESS_SECRET`/`AI_API_KEY_ENCRYPTION_SECRET` are real generated secrets, not the `.env.example` placeholders.
- [ ] R2 bucket created, API token scoped to it only, `R2_*` vars set — [R2 setup](./deployment.md#2-cloudflare-r2-file-storage).
- [ ] R2 bucket versioning enabled (recommended in [backup-restore.md](./backup-restore.md)) — one-time Cloudflare dashboard setting.
- [ ] SMTP credentials set if the low-stock digest email is needed at launch (optional — fails open to a log line if left unset, so not blocking).

## 4. Data

Choose one:

- [ ] **Fresh company via normal signup** (`POST /api/v1/companies/signup` / the `/signup` UI) — no migration involved, skip to §5.
- [ ] **Migrated from a legacy Apps Script deployment** — follow [docs/migration.md](./migration.md) in full: dry run against a disposable database, read the full reconciliation report, only then run the real cutover against this production database. **Do not skip the dry run for a "quick" first launch** — the reconciliation report is the only thing that actually proves a specific customer's real spreadsheet migrates correctly, and the migration toolkit has never been run end-to-end in this project's own development (disclosed in `migration-toolkit/README.md` and `docs/migration.md`).

## 5. Smoke test (do this as a real user, through the real UI, not just `curl`)

- [ ] Sign up / log in successfully.
- [ ] Create a product, confirm it appears in `/catalog` and `/catalog/grid`.
- [ ] Create a warehouse, record a stock movement (RECEIVE), confirm the quantity updates.
- [ ] Create an assembly/BOM, check cost calculation and availability.
- [ ] Create a production order, start it, confirm stock is consumed and a `FinishedGood` serial is generated.
- [ ] Create a customer order, a shipment, a purchase order — confirm each flow completes without error.
- [ ] Upload a file (a product photo or similar) — confirms R2 credentials and CORS are both actually correct end-to-end, not just configured.
- [ ] Invite a second user, assign a role, confirm they can log in with a different permission set than the Admin.
- [ ] Check `/admin/audit` — confirm the actions above actually appear in the audit trail.
- [ ] Log out, confirm `/dashboard` (and every other protected route) redirects to `/login` rather than rendering.
- [ ] Open `https://api.<domain>/api/docs` — Swagger loads, confirming the backend's public surface is reachable and versioned correctly.

## 6. Security

- [ ] `ufw status` shows only SSH/HTTP/HTTPS allowed — confirm `5432`/`3000`/`3001` are NOT reachable from outside the VPS (`nmap <vps-ip>` from an external machine, or simply confirm `docker compose ps` shows `127.0.0.1:` prefixes, not bare port numbers).
- [ ] `.env.prod` is not committed to git, is not world-readable on the VPS (`chmod 600 .env.prod`), and a copy exists in a password manager outside the VPS — [backup-restore.md](./backup-restore.md).
- [ ] SSH access to the VPS uses key-based auth, not password auth (Hostinger VPS default setup step, not specific to this app but worth confirming before going live).
- [ ] CORS actually rejects an unexpected origin — from a browser console on a *different* domain, confirm a fetch to `https://api.<domain>/api/v1/products` fails with a CORS error, not a successful response.
- [ ] Rate limiting is per-real-client, not per-proxy — real bug found and fixed during the audit: `main.ts` now sets `trust proxy` so `ThrottlerModule` reads the real client IP from `X-Forwarded-For` instead of Nginx's own address (which would have silently rate-limited every user together as one client). Confirm with two different real clients hitting the API in quick succession — neither should get a 429 caused by the other's traffic.

## 7. Backups and monitoring

- [ ] `ops/backup-postgres.sh` scheduled in cron, and **run manually once now** to confirm it actually works before relying on the schedule — [backup-restore.md](./backup-restore.md).
- [ ] That first backup confirmed present both locally (`/var/backups/sh-erp/`) and in R2 (`pg-backups/` prefix).
- [ ] An external uptime pinger (any provider — this doesn't need to be fancy) configured against `https://api.<domain>/health`, alerting someone real if it goes down.
- [ ] A calendar reminder set for the first quarterly restore drill — [backup-restore.md](./backup-restore.md#quarterly-restore-drill).

## 8. Rollback readiness

- [ ] Confirm `git log` on the VPS matches what's expected — you know exactly which commit is live.
- [ ] Confirm `ops/deploy.sh` + `git checkout <previous-commit>` is understood by whoever's on call as the rollback procedure for a bad code deploy — [deployment.md](./deployment.md#steady-state-releases).
- [ ] Confirm "roll forward with a corrective migration, never revert in place" is understood as the policy for a bad schema migration — same section.

## Go/no-go gate

**Do not point real users at this system until every box above is checked.** If something is intentionally deferred (e.g. SMTP not configured yet), that's fine — but it should be a deliberate, named decision, not a box silently left unchecked. Sections 1-2 (infrastructure, database) are the ones where a mistake is hardest to notice after the fact and most damaging if wrong — give those the most scrutiny, particularly the `app_user` privilege check in §2.

## First 24-48 hours after launch

- [ ] Watch `docker compose -f docker-compose.prod.yml logs -f backend` (or at least check it periodically) for anything unexpected — this is when a config mistake that passed the smoke test but only shows up under real, varied usage will surface.
- [ ] Confirm the next day's cron backup actually ran (check `/var/log/sh-erp-backup.log`).
- [ ] Watch disk usage (`df -h`) — a single VPS has finite disk, and this is the first real signal if Postgres data or Docker images are growing faster than expected.
- [ ] Follow up on anything from the smoke test that was a "works but ugly" rather than a clean pass.

## Known limitations at launch (carried forward from earlier documents, not resolved by this checklist)

- No automatic daily schedule for the low-stock digest — manual trigger or an external cron, see [admin-guide.md](./admin-guide.md#whats-not-automated-yet).
- No subdomain-based company switching — company is chosen at login.
- Public login-page branding (company logo) doesn't render before login — [admin-guide.md](./admin-guide.md#known-limitation-public-login-page-branding).
- Single VPS = single point of failure, ~24h backup RPO, no automatic failover — [backup-restore.md](./backup-restore.md#what-this-plan-does-not-yet-cover).
- No automated CI-triggered deploy for this path — every deploy is a manual `ops/deploy.sh` over SSH.
- No BullMQ/Redis background jobs, no OpenAPI contract-diff CI step, no `deploy-staging.yml`/`deploy-production.yml` — [deployment.md](./deployment.md#scope-boundaries-and-disclosed-gaps).

None of these block a first launch at the scale this system is being launched at — they're listed here so "launched" doesn't quietly drift into "and therefore fully done."
