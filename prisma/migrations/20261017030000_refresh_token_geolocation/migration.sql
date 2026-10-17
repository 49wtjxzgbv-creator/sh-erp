-- Browser-reported GPS on login, captured only by an actual interactive
-- login() (never refresh()/impersonation) — see the field's own
-- schema.prisma comment for the full rationale. No RLS/GRANT changes
-- needed: refresh_tokens has no RLS policy (accessed via AuthPrismaService/
-- SuperAdminPrismaService, which run before/outside the tenant RLS
-- context), and app_service already has column-agnostic SELECT/INSERT/
-- UPDATE/DELETE on this table from its original migration.

ALTER TABLE "refresh_tokens" ADD COLUMN "latitude" DECIMAL(9,6);
ALTER TABLE "refresh_tokens" ADD COLUMN "longitude" DECIMAL(9,6);
