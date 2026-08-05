# SH ERP v2 — Production Readiness Report

Date: 2026-08-05. Written at the end of the documentation + audit + Hostinger-prep pass, per the explicit request to state honestly whether this system is ready for its first deployment, with any remaining limitations listed plainly rather than glossed over.

## Bottom line

SH ERP v2 is ready for a first deployment to a Hostinger VPS, with one important caveat: every artifact built for that deployment (Dockerfiles, docker-compose.prod.yml, the Nginx templates, the ops/ scripts, the Prisma migrations) has been verified as thoroughly as this development sandbox allows — static analysis, syntax parsing, cross-referencing against the schema, compilation with zero new errors — but **none of it has been executed against a real Postgres instance, a real Docker daemon, or a real VPS**, because this sandbox has never had access to either a live Postgres server or a Docker daemon, and `binaries.prisma.sh` (needed for the real Prisma engine) has been unreachable from here in every session of this project. The first time these scripts actually run will be the real deploy. This is a real gap, not a formality — it's disclosed below with what verification was and wasn't possible.

## What's done

All 12 backend/frontend modules (Tenancy, Identity, Authorization, Audit, Files, Catalog, Settings, Inventory, BOM, Production, QC, Procurement, Sales, HR, Reports, AI, Notifications, Billing, Users/Roles/Audit) are implemented on both backend and frontend, with i18n across 4 locales and unit/e2e test coverage. The legacy Google Apps Script system's full feature set (Excel import/export, document/label printing, spreadsheet grid view, AI voice mode) has been ported. The migration toolkit (extract → transform → load → verify) is built and unit-tested, though — like the Docker/Postgres artifacts — never run end-to-end against a real legacy spreadsheet (disclosed in `migration-toolkit/README.md` and `docs/migration.md`).

Documentation is complete: `docs/deployment.md` (both the Hostinger VPS path and the original Vercel/Railway/Supabase path), `docs/migration.md`, `docs/backup-restore.md`, `docs/admin-guide.md`, `docs/launch-checklist.md`. All internal anchor links verified programmatically.

## What this session's audit found and fixed

Six real issues, all fixed immediately rather than deferred, per the instruction to not skip critical problems:

1. **No baseline Prisma migration existed at all** — `prisma migrate deploy` on a fresh database would have created nothing. Generated, verified via `pglast` (real Postgres-grammar parsing, 242/242 statements), and cross-checked all 85 foreign keys against real targets.
2. **RLS migration referenced snake_case columns that don't exist** (Prisma's actual naming is quoted camelCase without per-field `@map()`) — would have failed outright on first apply. Rewritten and reverified.
3. **No CORS configuration** — any cross-origin deployment (which this is, in both the Hostinger and managed paths) would have had every browser API call rejected. Fixed in `main.ts`.
4. **`backend/Dockerfile`'s runtime stage never copied `prisma/`** — `prisma migrate deploy` run inside the built container would fail on a missing schema file. Fixed.
5. **Missing `trust proxy` in Express** — behind any reverse proxy (Nginx on Hostinger, Railway's edge on the managed path), `ThrottlerModule`'s per-client rate limiting would have keyed off the proxy's own IP, silently rate-limiting all users together. This only manifests behind a real proxy, which is why no earlier local-dev verification caught it. Fixed.
6. **No root `.gitignore`, repo never initialized** — `.env.prod` (every production secret) had zero protection from an accidental commit. Fixed by writing a comprehensive `.gitignore` first, then running `git init` and one clean initial commit — confirmed via `git status` before committing that no `.env.prod`, `node_modules/`, or `.next/` got staged.

One more addition during the final audit pass: `ops/nginx/api.conf.template` now sets `proxy_read_timeout 120s` on the API location, since the AI module's function-calling loop and invoice-OCR endpoint can plausibly exceed Nginx's 60s default and would otherwise 504 even though the backend itself was still working.

## What's genuinely unverified (disclosed, not hidden)

- **Every Docker/Postgres/Nginx artifact is unexecuted.** This sandbox has no Docker daemon and no live Postgres — confirmed again just now (`docker: command not found`). Verification here means: `pglast` syntax parsing of all SQL, cross-referencing against `schema.prisma`, `tsc` compilation with zero new errors, and careful manual reasoning about each script. It does not mean any of it has actually run.
- **CI (`ci.yml`) has never actually executed** — there's no GitHub remote yet, only a local git repo (see below). The workflow file is well-formed YAML and mirrors what a real runner would do, but has not been proven against GitHub Actions' real environment.
- **The migration toolkit has never run against a real legacy spreadsheet** — same standing limitation carried since it was built, restated here rather than allowed to quietly disappear.
- **Local git repo, no remote yet.** `git init` plus one clean initial commit now exists locally in the project folder (previously there was no git repo at all). This was done because the documented VPS workflow (`git pull`, `git checkout <commit>` for rollback) assumes one, and because it closes the "no protection for `.env.prod`" gap for good rather than leaving it open until whenever a remote gets added. It has not been pushed anywhere — that's a step only you can do (create the GitHub/GitLab/Hostinger-git remote, `git remote add`, `git push`).

## Known limitations at launch (not blockers, but should be deliberate, not silent)

Carried forward from `docs/launch-checklist.md`: no automatic schedule for the low-stock digest (manual/external-cron trigger only), no subdomain-based company switching, public login-page branding doesn't render pre-login, single VPS = single point of failure with a ~24h backup RPO and no automatic failover, no CI-triggered auto-deploy for the Hostinger path (every deploy is a manual `ops/deploy.sh` over SSH), no Redis/BullMQ background jobs, no OpenAPI contract-diff CI step.

## Recommended next steps, in order

1. Push the local git repo to a real remote.
2. Provision the VPS and work through `docs/launch-checklist.md` top to bottom — it's sequenced deliberately; don't skip ahead.
3. Treat the first real run of `ops/hostinger-setup.sh`, the first `docker compose build`, and the first migration apply as the actual first test of this work — watch them closely, and expect to debug in real time rather than assuming a clean run.
4. Do the fresh-signup smoke test path (§4/§5 of the checklist) before attempting a real legacy-data migration.
