# SH ERP v2 — Administrator Guide

Two distinct audiences, covered in two parts: **(a) a company's own Admin user**, managing their team/settings/data inside the app, and **(b) whoever operates the Hostinger VPS** this system runs on. Most people reading this only need Part 1 — Part 2 is for the person with SSH access to the server itself.

## Part 1 — Application administration

Everything here is reachable through the UI by a user with the right role/permission; the underlying API route is listed alongside each for anyone scripting something or debugging via Swagger (`https://api.<your-domain>/api/docs`).

### Users, roles, and permissions

**`/admin`** (users list) and **`/admin/roles`** — gated behind `users:manage`/`roles:manage`, granted to the seeded Admin role by default.

- **Inviting a user**: `/admin` → Invite. If the email is brand new, a new global account + a temporary password is created and the person is added to your company. If the email already has an SH ERP account elsewhere (the system supports one login belonging to multiple companies), inviting them just adds a new membership to your company with the role you pick — no new account, no new password. (`POST /api/v1/users/invite`.)
- **Changing someone's role**: `/admin` → pick a user → change role. (`PATCH /api/v1/users/:userId/role`.)
- **Removing someone**: `/admin` → Deactivate. This removes their membership in *your* company only — it never deletes their global account, and it's blocked if they're the last member with any role in your company (so a company can never be left with zero users) or if you try to deactivate yourself. (`POST /api/v1/users/:userId/deactivate`.)
- **Custom roles and permissions**: `/admin/roles` — create a role from scratch, or edit an existing one's name/description/permission grants, including the 5 seeded default roles (Admin/Storekeeper/Production/Sales/Viewer) — their permissions can be changed, but they can never be deleted, and a role still assigned to at least one member can't be deleted either. (`GET /api/v1/roles/permissions-catalogue` lists every permission that exists in the system, for building a custom role.)
- **Your own password**: any user can change their own password from their account menu. (`PATCH /api/v1/users/me/password`.)

### Audit trail

**`/admin/audit`** — gated behind `audit:read`. Every write in this system (a stock movement, a role change, a production order status change, etc.) is logged here automatically by the module that performed it — there's no separate "enable auditing" step, and no way to turn it off from the UI (by design, matching the legacy system's old append-only `History` sheet guarantee, now DB-enforced rather than just a convention). Filterable by entity type, action, actor, and date range; drill into one entity's full history from its detail page.

### Company settings & branding

**`/settings`** — gated behind `settings:manage`.

- VAT rate, dashboard widget selection, and the daily low-stock digest (recipient email + on/off toggle) — the toggle enables the digest but does **not** put it on an automatic schedule (see [What's not automated yet](#whats-not-automated-yet) below; use "Send now" to trigger it manually until that's built).
- Branding: site logo, print logo, favicon — uploaded as file attachments, referenced by id, not raw URLs. Note the [known limitation](#known-limitation-public-login-page-branding) below about where this branding does and doesn't actually show up yet.

### AI settings

**`/ai/settings`** — gated behind `ai:settings-manage`.

- By default every company uses a platform-provided Gemini API key (metered by the platform). A company can instead bring their own key — set it here; it's stored envelope-encrypted (see `backend/src/modules/ai/ai-crypto.util.ts`'s own header comment for the honest disclosed gap versus a real KMS — application-level encryption today, a documented future upgrade). The key itself is never returned by the API once set, only whether one is configured.
- Monthly usage quota — a coarse token-count ceiling, not the finer Redis-token-bucket rate limiting originally designed (that's not built — see Scope boundaries in `docs/deployment.md`).

### Billing

**`/billing`** — gated behind `company:billing`. View the current plan and switch between the 3 seeded tiers (starter/growth/enterprise). This is explicitly a **stub**: switching plans records the change in the database, it does not collect payment or call Stripe — real payment collection was never in scope for this build (Phase 0 decision: "architecture should be subscription-ready but Stripe integration itself is not part of the initial build").

### Day-to-day domain administration

Everything else a company Admin does day to day — managing products, warehouses, BOMs, production orders, purchase/customer orders, employees/payroll — is covered by each module's own in-app UI, not repeated here since it's not admin-specific. The Excel import/export (`/catalog` → Import/Export) and the spreadsheet grid view (`/catalog/grid`) are worth knowing about specifically for bulk data entry/cleanup, since they're less discoverable than the main CRUD screens.

### Known limitation: public login-page branding

A company's logo cannot currently be shown on the public, pre-login `/login` screen. The public `GET /auth/companies/:slug/public-info` endpoint returns the branding file **ids**, but resolving an id to an actual displayable image URL requires an authenticated call (`GET /files/:id/download-url`, gated behind `files:read`) — so there's a real gap between what the public endpoint hands back and what can actually be rendered from it before login. Branding *inside* the authenticated app (topbar logo, etc.) is not affected by this. This is a backend fix (either a `@Public()` download-url variant gated on `FileAsset.isPublic`, or having the public-info endpoint resolve the URL itself), not something worth working around client-side — tracked, not silently ignored, and not blocking for a first launch since it's cosmetic only.

### What's not automated yet

- **The low-stock digest has no automatic daily schedule** — no background-job queue exists in this build (see `docs/deployment.md`'s Scope boundaries for the ADR-0005/BullMQ status). Trigger it manually (`/settings` → Send now) until that's built, or set up an external cron hitting `POST /api/v1/notifications/low-stock-digest/send-now` as a stopgap if daily automation is needed before that work happens.
- **No subdomain-based company switching** — a user picks their company at login rather than it being resolved from a subdomain. `Company.slug` exists in the schema for this future use but isn't wired up yet (see `docs/deployment.md`).

---

## Part 2 — Server administration (Hostinger VPS)

For whoever has SSH access to the VPS this system runs on. Assumes the [Hostinger VPS deployment](./deployment.md#hostinger-vps-first-launch) from `docs/deployment.md` is already set up — this section is about operating it day to day, not setting it up the first time.

### Checking system health

```bash
curl https://api.<your-domain>/health          # backend + live DB connectivity check
docker compose -f docker-compose.prod.yml ps    # which containers are up
```

### Viewing logs

```bash
docker compose -f docker-compose.prod.yml logs -f backend      # tail live
docker compose -f docker-compose.prod.yml logs --since 1h frontend
docker compose -f docker-compose.prod.yml logs postgres
```

Backend logs are structured JSON (`nestjs-pino`) — pipe through `jq` for readability if grepping for something specific: `docker compose -f docker-compose.prod.yml logs backend | jq .`. Bearer tokens are redacted at the source (`req.headers.authorization` is explicitly excluded from logging, `app.module.ts`'s `LoggerModule.forRoot` config) — never something to worry about leaking into a log file.

### Restarting a service

```bash
docker compose -f docker-compose.prod.yml restart backend
docker compose -f docker-compose.prod.yml restart frontend
```

Restarting `postgres` is riskier and rarely needed — only do it if the database itself is misbehaving, and expect a brief connection interruption for both other services while it comes back up.

### Deploying a new release

```bash
git pull
ops/deploy.sh
```

See [Steady-state releases](./deployment.md#steady-state-releases) in `docs/deployment.md` for what this does and the rollback procedure if something goes wrong.

### Applying a new database migration

Migrations are never automatic (same policy on every environment this project has — a schema change is a deliberate, reviewed step):

```bash
docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL="postgresql://postgres:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/sh_erp?schema=public" \
  backend npx prisma migrate deploy --schema=/app/prisma/schema.prisma
```

Run this **before** `ops/deploy.sh` rolls out code that depends on the new schema, immediately after `git pull` brings in the new migration file. See the [`app_user`/`postgres` role split](./deployment.md#app_userpostgres-role-split-self-hosted-postgres) in `docs/deployment.md` for why this uses the superuser connection, not `app_user`'s own.

### Rotating secrets

Covered in full in `docs/backup-restore.md`'s [Credential rotation runbook](./backup-restore.md#credential-rotation-runbook) — not repeated here.

### Backups

Covered in full in `docs/backup-restore.md` — that document, and the `ops/backup-postgres.sh`/`ops/restore-postgres.sh` scripts it's built around, are the authoritative source for anything backup/restore-related.

### When a single VPS stops being enough

Signs it's time to reconsider the topology (move the database to a managed provider, split services across multiple VPS instances, or move to the [managed multi-provider topology](./deployment.md#alternative-managed-multi-provider-topology) already documented as an alternative): the VPS is consistently CPU/memory-constrained under normal load, a single point of failure becomes unacceptable for the business, or the manual SSH-based deploy/backup workflow becomes a real bottleneck at team size. None of these are expected at first-launch scale — noted here so it's a deliberate decision made when the signs actually appear, not something guessed at preemptively.
