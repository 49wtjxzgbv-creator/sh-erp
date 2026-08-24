-- Migration: purchase_order_comments (Phase 2, 2026-08-24)
--
-- Flat, per-PurchaseOrder discussion thread shared by staff and the
-- connected supplier — closes the "no paper trail" gap identified in the
-- Phase 2 audit (only a single freeform PurchaseOrder.comment string
-- existed before this). Purely additive: one new table, one new enum, no
-- existing table/column touched, no backfill.
--
-- `authorUserId`/`authorSupplierPortalUserId` are bare, unconstrained
-- columns (no FK) — exactly the same "external actor" shape already used
-- by `delivery_schedules.respondedById` and `audit_events.actorUserId`,
-- since a comment author can be either a tenant-scoped staff User or a
-- global SupplierPortalUser, and this schema never puts a cross-role FK on
-- top of that distinction (see those columns' own header comments).
--
-- FK to purchase_orders uses the same composite (companyId, id) shape as
-- PurchaseOrderItem.purchaseOrder — ON DELETE CASCADE, a comment has no
-- meaning without its order.
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-
-- authored migration in this project.

CREATE TYPE "PurchaseOrderCommentAuthorType" AS ENUM ('STAFF', 'SUPPLIER');

CREATE TABLE "purchase_order_comments" (
    "id"                         UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"                  UUID NOT NULL,
    "purchaseOrderId"            UUID NOT NULL,
    "authorType"                 "PurchaseOrderCommentAuthorType" NOT NULL,
    "authorUserId"               UUID,
    "authorSupplierPortalUserId" UUID,
    "body"                       TEXT NOT NULL,
    "createdAt"                  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_order_comments_companyId_purchaseOrderId_createdAt_idx" ON "purchase_order_comments"("companyId", "purchaseOrderId", "createdAt");

ALTER TABLE "purchase_order_comments" ADD CONSTRAINT "purchase_order_comments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_comments" ADD CONSTRAINT "purchase_order_comments_companyId_purchaseOrderId_fkey" FOREIGN KEY ("companyId", "purchaseOrderId") REFERENCES "purchase_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE purchase_order_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_comments
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);
