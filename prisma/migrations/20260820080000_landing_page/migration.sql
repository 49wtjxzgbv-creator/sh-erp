-- Migration: landing_page
--
-- Super-Admin-editable public marketing homepage content (2026-08-20 spec):
-- landing_page_versions holds the full page content as one JSON blob per
-- version, versioned with an immutable append-only-on-publish philosophy
-- (mirrors assembly_versions) — the single DRAFT row is the deliberate
-- exception, mutated in place while an admin is actively editing.
-- landing_media_assets holds marketing images (hero/showcase screenshots,
-- OG image) via their own small presigned-upload flow, separate from
-- file_assets (that table's companyId is required/tenant-scoped; this
-- content is company-independent).
--
-- Neither table has a companyId — same non-tenant, non-RLS shape as `plans`
-- — both are global, platform-owned content, not per-company data.
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-authored
-- migration in this project (see backend/README.md).

-- CreateEnum
CREATE TYPE "LandingPageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "landing_page_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "LandingPageStatus" NOT NULL DEFAULT 'DRAFT',
    "versionNumber" INTEGER,
    "content" JSONB NOT NULL,
    "createdById" UUID NOT NULL,
    "publishedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "landing_page_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "landing_page_versions_status_idx" ON "landing_page_versions"("status");

-- Partial unique indexes: Prisma has no declarative attribute for these, so
-- they're hand-written here (same "Prisma limitation, raw SQL" pattern
-- already used for AssemblyComponent's CHECK constraint elsewhere in this
-- schema). Guarantees at the DB level — not just service-layer discipline —
-- that "the draft" and "the published version" are always unambiguous.
CREATE UNIQUE INDEX "landing_page_versions_one_draft" ON "landing_page_versions" ("status") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "landing_page_versions_one_published" ON "landing_page_versions" ("status") WHERE "status" = 'PUBLISHED';

ALTER TABLE "landing_page_versions" ADD CONSTRAINT "landing_page_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "super_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "landing_page_versions" ADD CONSTRAINT "landing_page_versions_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "super_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "landing_media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "altText" JSONB,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "landing_media_assets_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "landing_media_assets" ADD CONSTRAINT "landing_media_assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "super_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- These two tables run through the normal (non-superuser) DATABASE_URL
-- connection like any other migration, so app_user owns them automatically
-- (same as `plans`/`company_subscriptions` — no explicit app_user grant
-- needed for tables it creates itself). But `super_admin_service`
-- (SuperAdminPrismaService, BYPASSRLS, least-privilege) is a SEPARATE role
-- that only sees tables it's explicitly granted — same requirement `plans`
-- already had in prisma/migrations/20260805100000_add_super_admin. Without
-- these grants, every Super Admin landing-page endpoint would fail with a
-- permission-denied error at runtime despite passing SuperAdminGuard.
GRANT SELECT, INSERT, UPDATE ON TABLE landing_page_versions TO super_admin_service;
GRANT SELECT, INSERT, UPDATE ON TABLE landing_media_assets TO super_admin_service;
