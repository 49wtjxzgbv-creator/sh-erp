-- Baseline schema migration, generated from prisma/schema.prisma.
--
-- Real gap found and fixed during the production-readiness / deployment-
-- documentation pass: no baseline migration for schema.prisma existed at all --
-- only the two supplementary migrations existed, and both explicitly assume
-- this one already ran (20260804000000_create_auth_service_role's header
-- comment says so directly; 20260805000000_enable_rls_and_check_constraints
-- ALTERs tables that only this file actually creates). Without this file,
-- `prisma migrate deploy` against a fresh database creates nothing and the
-- other two migrations fail immediately. Generated (not hand-typed) by a
-- small script that parses schema.prisma directly, the same discipline
-- already used for the RLS/CHECK migration, to avoid the transcription-
-- omission risk of hand-authoring ~48 CREATE TABLE statements by hand.
--
-- Requires gen_random_uuid(), built into Postgres 13+ core, and the citext
-- extension (schema.prisma's own `extensions = [citext]`).
--
-- Column naming note: schema.prisma has @@map() on every model (table names),
-- but deliberately NO @map() on individual fields, so Prisma's real generated
-- column names are the exact camelCase field names, quoted to preserve case
-- (e.g. "companyId", not company_id). This matters: the RLS/CHECK migration
-- alongside this one was originally hand-written assuming snake_case columns
-- and has been corrected in the same pass that produced this file -- see that
-- migration's own header note.

CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- Enums
-- ============================================================

CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'OFFBOARDED');
CREATE TYPE "FileDomain" AS ENUM ('PRODUCT_PHOTO', 'ASSEMBLY_PHOTO', 'ASSEMBLY_DRAWING', 'CUSTOMER_ORDER_DOCUMENT', 'PURCHASE_INVOICE', 'EMPLOYEE_PHOTO', 'QC_PHOTO', 'SHIPMENT_PHOTO', 'BRANDING');
CREATE TYPE "StockMovementType" AS ENUM ('RECEIVE', 'ISSUE', 'ADJUST', 'MOVE', 'DEFECT_WRITE_OFF', 'ASSEMBLY_CONSUMPTION', 'PRODUCTION_CONSUMPTION', 'INVENTORY_RECONCILIATION');
CREATE TYPE "InventorySessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "ComponentType" AS ENUM ('PRODUCT', 'ASSEMBLY');
CREATE TYPE "ProductionOrderStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "FinishedGoodStatus" AS ENUM ('IN_STOCK', 'SHIPPED', 'CONSUMED', 'REWORK', 'DEFECTIVE');
CREATE TYPE "QcResult" AS ENUM ('ACCEPTED', 'REWORK');
CREATE TYPE "CustomerOrderPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "CustomerOrderStatus" AS ENUM ('NEW', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ShipmentStatus" AS ENUM ('SHIPPED', 'DELIVERED');
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('ORDERED', 'PARTIAL', 'DELIVERED');
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "PayrollEntryType" AS ENUM ('PIECEWORK', 'ADVANCE', 'BONUS', 'PENALTY');
CREATE TYPE "PendingAiActionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');
CREATE TYPE "MigrationRunStatus" AS ENUM ('EXTRACTING', 'TRANSFORMING', 'LOADING', 'VERIFYING', 'COMPLETED', 'FAILED');

-- ============================================================
-- Tables
-- ============================================================

CREATE TABLE "companies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Kyiv',
  "locale" TEXT NOT NULL DEFAULT 'uk',
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_companies_slug" UNIQUE ("slug"),
  CONSTRAINT "uq_companies_legacyId" UNIQUE ("legacyId")
);

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" CITEXT NOT NULL,
  "login" CITEXT,
  "fullName" TEXT NOT NULL,
  "passwordHash" TEXT,
  "legacyPasswordHash" TEXT,
  "mfaSecret" TEXT,
  "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_users_email" UNIQUE ("email"),
  CONSTRAINT "uq_users_login" UNIQUE ("login")
);

CREATE TABLE "company_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "roleId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "permissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_permissions_key" UNIQUE ("key")
);

CREATE TABLE "role_permissions" (
  "roleId" UUID NOT NULL,
  "permissionId" UUID NOT NULL,
  PRIMARY KEY ("roleId", "permissionId")
);

CREATE TABLE "refresh_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "familyId" UUID NOT NULL,
  "device" TEXT,
  "ipAddress" TEXT,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_refresh_tokens_tokenHash" UNIQUE ("tokenHash")
);

CREATE TABLE "audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "actorUserId" UUID,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "feature_flags" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "defaultOn" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_feature_flags_key" UNIQUE ("key")
);

CREATE TABLE "company_feature_flag_overrides" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "featureFlagId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "file_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "domain" "FileDomain" NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "uploadedById" UUID,
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);

CREATE TABLE "products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "article" CITEXT NOT NULL,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT,
  "productGroup" TEXT,
  "family" TEXT,
  "type" TEXT,
  "kind" TEXT,
  "productLine" TEXT,
  "barcode" TEXT,
  "unitId" UUID NOT NULL,
  "unitsPerPackage" DECIMAL(14,3),
  "cell" TEXT,
  "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "minQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "localPriceExclVat" DECIMAL(14,2),
  "localPriceInclVat" DECIMAL(14,2),
  "germanPriceExclVat" DECIMAL(14,2),
  "germanPriceInclVat" DECIMAL(14,2),
  "sellPriceEur" DECIMAL(14,2),
  "weightPerUnitKg" DECIMAL(10,3),
  "warrantyMonths" TEXT,
  "status" TEXT,
  "manufacturer" TEXT,
  "manufacturerCode" TEXT,
  "countryOfOrigin" TEXT,
  "priceListRef" TEXT,
  "note" TEXT,
  "defaultSupplierId" UUID,
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);

CREATE TABLE "company_units" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "suppliers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "contactPerson" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "notes" TEXT,
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);

CREATE TABLE "warehouses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);

CREATE TABLE "warehouse_stock" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "stock_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "warehouseId" UUID,
  "type" "StockMovementType" NOT NULL,
  "qtyDelta" DECIMAL(14,3) NOT NULL,
  "qtyAfter" DECIMAL(14,3) NOT NULL,
  "comment" TEXT,
  "actorUserId" UUID,
  "sourceType" TEXT,
  "sourceId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "inventory_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "status" "InventorySessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "startedById" UUID NOT NULL,
  "comment" TEXT,
  "legacyId" TEXT,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "completedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);

CREATE TABLE "inventory_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "inventorySessionId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "expectedQty" DECIMAL(14,3) NOT NULL,
  "actualQty" DECIMAL(14,3),
  "counted" BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY ("id")
);

CREATE TABLE "assemblies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "article" TEXT,
  "note" TEXT,
  "laborCostPerUnit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "packagingCostPerUnit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "deliveryCostPerUnit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "otherCostPerUnit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "defaultSupplierId" UUID,
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);

CREATE TABLE "assembly_components" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "assemblyId" UUID NOT NULL,
  "componentType" "ComponentType" NOT NULL,
  "productId" UUID,
  "subAssemblyId" UUID,
  "warehouseId" UUID,
  "qtyPerUnit" DECIMAL(14,4) NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "assembly_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "assemblyId" UUID NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "assembly_version_components" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "assemblyVersionId" UUID NOT NULL,
  "componentType" "ComponentType" NOT NULL,
  "productId" UUID,
  "subAssemblyId" UUID,
  "warehouseId" UUID,
  "qtyPerUnit" DECIMAL(14,4) NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "production_stages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "production_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "assemblyId" UUID NOT NULL,
  "assemblyVersionId" UUID,
  "unitsPlanned" DECIMAL(14,3) NOT NULL,
  "status" "ProductionOrderStatus" NOT NULL DEFAULT 'PLANNED',
  "createdById" UUID NOT NULL,
  "comment" TEXT,
  "currentStageIndex" INTEGER,
  "totalLocalCostEur" DECIMAL(14,2),
  "totalGermanCostEur" DECIMAL(14,2),
  "laborCostEur" DECIMAL(14,2),
  "packagingCostEur" DECIMAL(14,2),
  "deliveryCostEur" DECIMAL(14,2),
  "otherCostEur" DECIMAL(14,2),
  "fullCostEur" DECIMAL(14,2),
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "completedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);

CREATE TABLE "production_order_pick_list_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "productionOrderId" UUID NOT NULL,
  "productId" UUID,
  "description" TEXT NOT NULL,
  "qty" DECIMAL(14,3) NOT NULL,
  "unitPriceEur" DECIMAL(14,2),
  "lineTotalEur" DECIMAL(14,2),
  "consumedFinishedGoodIds" TEXT[] NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "production_order_stage_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "productionOrderId" UUID NOT NULL,
  "stageIndex" INTEGER NOT NULL,
  "actorUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "production_order_workers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "productionOrderId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "percent" DECIMAL(5,2) NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "finished_goods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "serialNumber" TEXT NOT NULL,
  "assemblyId" UUID NOT NULL,
  "productionOrderId" UUID NOT NULL,
  "status" "FinishedGoodStatus" NOT NULL DEFAULT 'IN_STOCK',
  "customerOrderId" UUID,
  "comment" TEXT,
  "unitCostLocalEur" DECIMAL(14,2) NOT NULL,
  "unitCostGermanEur" DECIMAL(14,2) NOT NULL,
  "consumedInProductionOrderId" UUID,
  "legacyId" TEXT,
  "manufactureDate" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_finished_goods_serialNumber" UNIQUE ("serialNumber")
);

CREATE TABLE "qc_checklist_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "qc_checks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "finishedGoodId" UUID NOT NULL,
  "result" "QcResult" NOT NULL,
  "inspectorId" UUID NOT NULL,
  "comment" TEXT,
  "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "qc_check_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "qcCheckId" UUID NOT NULL,
  "itemName" TEXT NOT NULL,
  "passed" BOOLEAN NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "customer_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "orderNumber" TEXT,
  "clientName" TEXT NOT NULL,
  "contactPerson" TEXT,
  "deadline" TIMESTAMPTZ(3),
  "priority" "CustomerOrderPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "CustomerOrderStatus" NOT NULL DEFAULT 'NEW',
  "comment" TEXT,
  "createdById" UUID NOT NULL,
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "customer_order_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "customerOrderId" UUID NOT NULL,
  "assemblyId" UUID NOT NULL,
  "qty" DECIMAL(14,3) NOT NULL,
  "productionOrderId" UUID,
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_customer_order_items_productionOrderId" UNIQUE ("productionOrderId")
);

CREATE TABLE "shipments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "carrier" TEXT,
  "waybillNumber" TEXT,
  "packageCount" INTEGER,
  "weightKg" DECIMAL(10,3),
  "dimensions" TEXT,
  "status" "ShipmentStatus" NOT NULL DEFAULT 'SHIPPED',
  "customerOrderId" UUID,
  "comment" TEXT,
  "createdById" UUID NOT NULL,
  "legacyId" TEXT,
  "shipDate" TIMESTAMPTZ(3),
  "deliveryDate" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "shipment_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "finishedGoodId" UUID NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "purchase_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "supplierId" UUID,
  "supplierNameSnapshot" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'ORDERED',
  "orderDate" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "expectedDeliveryDate" TIMESTAMPTZ(3),
  "comment" TEXT,
  "sourceCustomerOrderId" UUID,
  "createdById" UUID NOT NULL,
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "purchase_order_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "purchaseOrderId" UUID NOT NULL,
  "productId" UUID,
  "articleSnapshot" TEXT NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "qtyOrdered" DECIMAL(14,3) NOT NULL,
  "qtyReceived" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "expectedPrice" DECIMAL(14,2),
  "actualPrice" DECIMAL(14,2),
  PRIMARY KEY ("id")
);

CREATE TABLE "employees" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "fullName" TEXT NOT NULL,
  "position" TEXT,
  "phone" TEXT,
  "hireDate" TIMESTAMPTZ(3),
  "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "payroll_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "type" "PayrollEntryType" NOT NULL,
  "productionOrderId" UUID,
  "unitsProduced" DECIMAL(14,3),
  "amount" DECIMAL(14,2) NOT NULL,
  "entryDate" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "comment" TEXT,
  "createdById" UUID NOT NULL,
  "legacyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "company_settings" (
  "companyId" UUID NOT NULL,
  "vatRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 20,
  "dashboardWidgets" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "dailyDigestEmail" TEXT,
  "dailyDigestEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("companyId")
);

CREATE TABLE "company_branding" (
  "companyId" UUID NOT NULL,
  "siteLogoFileId" UUID,
  "printLogoFileId" UUID,
  "faviconFileId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("companyId")
);

CREATE TABLE "company_ai_settings" (
  "companyId" UUID NOT NULL,
  "apiKeyEncrypted" TEXT,
  "monthlyUsageQuota" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("companyId")
);

CREATE TABLE "pending_ai_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "actionKey" TEXT NOT NULL,
  "args" JSONB NOT NULL,
  "description" TEXT NOT NULL,
  "status" "PendingAiActionStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "resolvedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "feature" TEXT NOT NULL,
  "tokensUsed" INTEGER,
  "costEstimate" DECIMAL(10,4),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "monthlyPriceEur" DECIMAL(10,2) NOT NULL,
  "limits" JSONB NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_plans_key" UNIQUE ("key")
);

CREATE TABLE "company_subscriptions" (
  "companyId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "currentPeriodEnd" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("companyId")
);

CREATE TABLE "legacy_migration_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "status" "MigrationRunStatus" NOT NULL DEFAULT 'EXTRACTING',
  "sourceDeploymentId" TEXT,
  "reconciliationReport" JSONB,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "completedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);

-- ============================================================
-- Unique constraints / indexes (@@unique, @@index)
-- ============================================================

ALTER TABLE "company_memberships" ADD CONSTRAINT "uq_company_memberships_companyId_userId" UNIQUE ("companyId", "userId");
CREATE INDEX "idx_company_memberships_companyId" ON "company_memberships" ("companyId");
CREATE INDEX "idx_company_memberships_userId" ON "company_memberships" ("userId");
ALTER TABLE "roles" ADD CONSTRAINT "uq_roles_companyId_name" UNIQUE ("companyId", "name");
ALTER TABLE "roles" ADD CONSTRAINT "uq_roles_companyId_id" UNIQUE ("companyId", "id");
CREATE INDEX "idx_roles_companyId" ON "roles" ("companyId");
CREATE INDEX "idx_refresh_tokens_userId" ON "refresh_tokens" ("userId");
CREATE INDEX "idx_refresh_tokens_familyId" ON "refresh_tokens" ("familyId");
CREATE INDEX "idx_refresh_tokens_expiresAt" ON "refresh_tokens" ("expiresAt");
CREATE INDEX "idx_audit_events_companyId_entityType_entityId" ON "audit_events" ("companyId", "entityType", "entityId");
CREATE INDEX "idx_audit_events_companyId_createdAt" ON "audit_events" ("companyId", "createdAt");
ALTER TABLE "company_feature_flag_overrides" ADD CONSTRAINT "uq_company_feature_flag_overrides_companyId_featureFlagId" UNIQUE ("companyId", "featureFlagId");
CREATE INDEX "idx_company_feature_flag_overrides_companyId" ON "company_feature_flag_overrides" ("companyId");
CREATE INDEX "idx_file_assets_companyId_entityType_entityId" ON "file_assets" ("companyId", "entityType", "entityId");
ALTER TABLE "file_assets" ADD CONSTRAINT "uq_file_assets_companyId_legacyId" UNIQUE ("companyId", "legacyId");
ALTER TABLE "products" ADD CONSTRAINT "uq_products_companyId_article" UNIQUE ("companyId", "article");
ALTER TABLE "products" ADD CONSTRAINT "uq_products_companyId_id" UNIQUE ("companyId", "id");
ALTER TABLE "products" ADD CONSTRAINT "uq_products_companyId_legacyId" UNIQUE ("companyId", "legacyId");
CREATE INDEX "idx_products_companyId_category" ON "products" ("companyId", "category");
CREATE INDEX "idx_products_companyId_name" ON "products" ("companyId", "name");
CREATE INDEX "idx_products_companyId_barcode" ON "products" ("companyId", "barcode");
CREATE INDEX "idx_products_companyId_unitId" ON "products" ("companyId", "unitId");
ALTER TABLE "company_units" ADD CONSTRAINT "uq_company_units_companyId_name" UNIQUE ("companyId", "name");
ALTER TABLE "company_units" ADD CONSTRAINT "uq_company_units_companyId_id" UNIQUE ("companyId", "id");
ALTER TABLE "suppliers" ADD CONSTRAINT "uq_suppliers_companyId_legacyId" UNIQUE ("companyId", "legacyId");
CREATE INDEX "idx_suppliers_companyId" ON "suppliers" ("companyId");
CREATE INDEX "idx_warehouses_companyId" ON "warehouses" ("companyId");
ALTER TABLE "warehouses" ADD CONSTRAINT "uq_warehouses_companyId_id" UNIQUE ("companyId", "id");
ALTER TABLE "warehouses" ADD CONSTRAINT "uq_warehouses_companyId_legacyId" UNIQUE ("companyId", "legacyId");
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "uq_warehouse_stock_companyId_productId_warehouseId" UNIQUE ("companyId", "productId", "warehouseId");
CREATE INDEX "idx_stock_movements_companyId_productId_createdAt" ON "stock_movements" ("companyId", "productId", "createdAt");
CREATE INDEX "idx_inventory_sessions_companyId" ON "inventory_sessions" ("companyId");
ALTER TABLE "inventory_sessions" ADD CONSTRAINT "uq_inventory_sessions_companyId_id" UNIQUE ("companyId", "id");
ALTER TABLE "inventory_sessions" ADD CONSTRAINT "uq_inventory_sessions_companyId_legacyId" UNIQUE ("companyId", "legacyId");
CREATE INDEX "idx_inventory_items_inventorySessionId" ON "inventory_items" ("inventorySessionId");
CREATE INDEX "idx_inventory_items_companyId" ON "inventory_items" ("companyId");
CREATE INDEX "idx_assemblies_companyId" ON "assemblies" ("companyId");
ALTER TABLE "assemblies" ADD CONSTRAINT "uq_assemblies_companyId_id" UNIQUE ("companyId", "id");
ALTER TABLE "assemblies" ADD CONSTRAINT "uq_assemblies_companyId_legacyId" UNIQUE ("companyId", "legacyId");
CREATE INDEX "idx_assembly_components_assemblyId" ON "assembly_components" ("assemblyId");
CREATE INDEX "idx_assembly_components_companyId" ON "assembly_components" ("companyId");
ALTER TABLE "assembly_versions" ADD CONSTRAINT "uq_assembly_versions_assemblyId_versionNumber" UNIQUE ("assemblyId", "versionNumber");
CREATE INDEX "idx_assembly_versions_companyId" ON "assembly_versions" ("companyId");
ALTER TABLE "assembly_versions" ADD CONSTRAINT "uq_assembly_versions_companyId_id" UNIQUE ("companyId", "id");
CREATE INDEX "idx_assembly_version_components_assemblyVersionId" ON "assembly_version_components" ("assemblyVersionId");
CREATE INDEX "idx_assembly_version_components_companyId" ON "assembly_version_components" ("companyId");
CREATE INDEX "idx_production_stages_companyId" ON "production_stages" ("companyId");
CREATE INDEX "idx_production_orders_companyId_status" ON "production_orders" ("companyId", "status");
ALTER TABLE "production_orders" ADD CONSTRAINT "uq_production_orders_companyId_id" UNIQUE ("companyId", "id");
ALTER TABLE "production_orders" ADD CONSTRAINT "uq_production_orders_companyId_legacyId" UNIQUE ("companyId", "legacyId");
CREATE INDEX "idx_production_order_pick_list_items_productionOrderId" ON "production_order_pick_list_items" ("productionOrderId");
CREATE INDEX "idx_production_order_pick_list_items_companyId" ON "production_order_pick_list_items" ("companyId");
CREATE INDEX "idx_production_order_stage_events_productionOrderId" ON "production_order_stage_events" ("productionOrderId");
CREATE INDEX "idx_production_order_stage_events_companyId" ON "production_order_stage_events" ("companyId");
ALTER TABLE "production_order_workers" ADD CONSTRAINT "uq_production_order_workers_productionOrderId_employeeId" UNIQUE ("productionOrderId", "employeeId");
CREATE INDEX "idx_production_order_workers_companyId" ON "production_order_workers" ("companyId");
CREATE INDEX "idx_finished_goods_companyId_status" ON "finished_goods" ("companyId", "status");
CREATE INDEX "idx_finished_goods_companyId_assemblyId" ON "finished_goods" ("companyId", "assemblyId");
CREATE INDEX "idx_finished_goods_customerOrderId" ON "finished_goods" ("customerOrderId");
CREATE INDEX "idx_finished_goods_consumedInProductionOrderId" ON "finished_goods" ("consumedInProductionOrderId");
ALTER TABLE "finished_goods" ADD CONSTRAINT "uq_finished_goods_companyId_id" UNIQUE ("companyId", "id");
ALTER TABLE "finished_goods" ADD CONSTRAINT "uq_finished_goods_companyId_legacyId" UNIQUE ("companyId", "legacyId");
CREATE INDEX "idx_qc_checklist_items_companyId" ON "qc_checklist_items" ("companyId");
CREATE INDEX "idx_qc_checks_companyId_finishedGoodId" ON "qc_checks" ("companyId", "finishedGoodId");
ALTER TABLE "qc_checks" ADD CONSTRAINT "uq_qc_checks_companyId_id" UNIQUE ("companyId", "id");
CREATE INDEX "idx_qc_check_results_qcCheckId" ON "qc_check_results" ("qcCheckId");
CREATE INDEX "idx_qc_check_results_companyId" ON "qc_check_results" ("companyId");
CREATE INDEX "idx_customer_orders_companyId_status" ON "customer_orders" ("companyId", "status");
ALTER TABLE "customer_orders" ADD CONSTRAINT "uq_customer_orders_companyId_id" UNIQUE ("companyId", "id");
ALTER TABLE "customer_orders" ADD CONSTRAINT "uq_customer_orders_companyId_legacyId" UNIQUE ("companyId", "legacyId");
CREATE INDEX "idx_customer_order_items_customerOrderId" ON "customer_order_items" ("customerOrderId");
CREATE INDEX "idx_customer_order_items_companyId" ON "customer_order_items" ("companyId");
CREATE INDEX "idx_customer_order_items_assemblyId" ON "customer_order_items" ("assemblyId");
CREATE INDEX "idx_shipments_companyId_status" ON "shipments" ("companyId", "status");
ALTER TABLE "shipments" ADD CONSTRAINT "uq_shipments_companyId_id" UNIQUE ("companyId", "id");
ALTER TABLE "shipments" ADD CONSTRAINT "uq_shipments_companyId_legacyId" UNIQUE ("companyId", "legacyId");
CREATE INDEX "idx_shipment_items_shipmentId" ON "shipment_items" ("shipmentId");
CREATE INDEX "idx_shipment_items_companyId" ON "shipment_items" ("companyId");
CREATE INDEX "idx_purchase_orders_companyId_status" ON "purchase_orders" ("companyId", "status");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "uq_purchase_orders_companyId_id" UNIQUE ("companyId", "id");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "uq_purchase_orders_companyId_legacyId" UNIQUE ("companyId", "legacyId");
CREATE INDEX "idx_purchase_order_items_purchaseOrderId" ON "purchase_order_items" ("purchaseOrderId");
CREATE INDEX "idx_purchase_order_items_companyId" ON "purchase_order_items" ("companyId");
CREATE INDEX "idx_employees_companyId" ON "employees" ("companyId");
ALTER TABLE "employees" ADD CONSTRAINT "uq_employees_companyId_id" UNIQUE ("companyId", "id");
ALTER TABLE "employees" ADD CONSTRAINT "uq_employees_companyId_legacyId" UNIQUE ("companyId", "legacyId");
CREATE INDEX "idx_payroll_entries_companyId_employeeId" ON "payroll_entries" ("companyId", "employeeId");
ALTER TABLE "payroll_entries" ADD CONSTRAINT "uq_payroll_entries_companyId_legacyId" UNIQUE ("companyId", "legacyId");
CREATE INDEX "idx_pending_ai_actions_companyId_status" ON "pending_ai_actions" ("companyId", "status");
CREATE INDEX "idx_ai_usage_logs_companyId_createdAt" ON "ai_usage_logs" ("companyId", "createdAt");
CREATE INDEX "idx_legacy_migration_runs_companyId" ON "legacy_migration_runs" ("companyId");

-- ============================================================
-- Foreign keys (added after all tables exist, matching real
-- Prisma Migrate output ordering)
-- ============================================================

ALTER TABLE "company_memberships" ADD CONSTRAINT "fk_company_memberships_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "company_memberships" ADD CONSTRAINT "fk_company_memberships_user" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT;
ALTER TABLE "company_memberships" ADD CONSTRAINT "fk_company_memberships_role" FOREIGN KEY ("companyId", "roleId") REFERENCES "roles" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "roles" ADD CONSTRAINT "fk_roles_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_role" FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE RESTRICT;
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_permission" FOREIGN KEY ("permissionId") REFERENCES "permissions" ("id") ON DELETE RESTRICT;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "fk_refresh_tokens_user" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT;
ALTER TABLE "company_feature_flag_overrides" ADD CONSTRAINT "fk_company_feature_flag_overrides_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "company_feature_flag_overrides" ADD CONSTRAINT "fk_company_feature_flag_overrides_featureFlag" FOREIGN KEY ("featureFlagId") REFERENCES "feature_flags" ("id") ON DELETE RESTRICT;
ALTER TABLE "file_assets" ADD CONSTRAINT "fk_file_assets_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "products" ADD CONSTRAINT "fk_products_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "products" ADD CONSTRAINT "fk_products_unit" FOREIGN KEY ("companyId", "unitId") REFERENCES "company_units" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "products" ADD CONSTRAINT "fk_products_defaultSupplier" FOREIGN KEY ("defaultSupplierId") REFERENCES "suppliers" ("id") ON DELETE SET NULL;
ALTER TABLE "company_units" ADD CONSTRAINT "fk_company_units_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "suppliers" ADD CONSTRAINT "fk_suppliers_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "warehouses" ADD CONSTRAINT "fk_warehouses_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "fk_warehouse_stock_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "fk_warehouse_stock_product" FOREIGN KEY ("companyId", "productId") REFERENCES "products" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "fk_warehouse_stock_warehouse" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "warehouses" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_product" FOREIGN KEY ("companyId", "productId") REFERENCES "products" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_warehouse" FOREIGN KEY ("warehouseId") REFERENCES "warehouses" ("id") ON DELETE SET NULL;
ALTER TABLE "inventory_sessions" ADD CONSTRAINT "fk_inventory_sessions_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inventory_items_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inventory_items_session" FOREIGN KEY ("companyId", "inventorySessionId") REFERENCES "inventory_sessions" ("companyId", "id") ON DELETE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inventory_items_product" FOREIGN KEY ("companyId", "productId") REFERENCES "products" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "assemblies" ADD CONSTRAINT "fk_assemblies_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "assemblies" ADD CONSTRAINT "fk_assemblies_defaultSupplier" FOREIGN KEY ("defaultSupplierId") REFERENCES "suppliers" ("id") ON DELETE SET NULL;
ALTER TABLE "assembly_components" ADD CONSTRAINT "fk_assembly_components_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "assembly_components" ADD CONSTRAINT "fk_assembly_components_assembly" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies" ("companyId", "id") ON DELETE CASCADE;
ALTER TABLE "assembly_components" ADD CONSTRAINT "fk_assembly_components_product" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE SET NULL;
ALTER TABLE "assembly_components" ADD CONSTRAINT "fk_assembly_components_subAssembly" FOREIGN KEY ("subAssemblyId") REFERENCES "assemblies" ("id") ON DELETE SET NULL;
ALTER TABLE "assembly_components" ADD CONSTRAINT "fk_assembly_components_warehouse" FOREIGN KEY ("warehouseId") REFERENCES "warehouses" ("id") ON DELETE SET NULL;
ALTER TABLE "assembly_versions" ADD CONSTRAINT "fk_assembly_versions_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "assembly_versions" ADD CONSTRAINT "fk_assembly_versions_assembly" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "assembly_version_components" ADD CONSTRAINT "fk_assembly_version_components_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "assembly_version_components" ADD CONSTRAINT "fk_assembly_version_components_assemblyVersion" FOREIGN KEY ("companyId", "assemblyVersionId") REFERENCES "assembly_versions" ("companyId", "id") ON DELETE CASCADE;
ALTER TABLE "production_stages" ADD CONSTRAINT "fk_production_stages_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "production_orders" ADD CONSTRAINT "fk_production_orders_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "production_orders" ADD CONSTRAINT "fk_production_orders_assembly" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "production_orders" ADD CONSTRAINT "fk_production_orders_assemblyVersion" FOREIGN KEY ("assemblyVersionId") REFERENCES "assembly_versions" ("id") ON DELETE SET NULL;
ALTER TABLE "production_order_pick_list_items" ADD CONSTRAINT "fk_production_order_pick_list_items_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "production_order_pick_list_items" ADD CONSTRAINT "fk_production_order_pick_list_items_productionOrder" FOREIGN KEY ("companyId", "productionOrderId") REFERENCES "production_orders" ("companyId", "id") ON DELETE CASCADE;
ALTER TABLE "production_order_stage_events" ADD CONSTRAINT "fk_production_order_stage_events_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "production_order_stage_events" ADD CONSTRAINT "fk_production_order_stage_events_productionOrder" FOREIGN KEY ("companyId", "productionOrderId") REFERENCES "production_orders" ("companyId", "id") ON DELETE CASCADE;
ALTER TABLE "production_order_workers" ADD CONSTRAINT "fk_production_order_workers_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "production_order_workers" ADD CONSTRAINT "fk_production_order_workers_productionOrder" FOREIGN KEY ("companyId", "productionOrderId") REFERENCES "production_orders" ("companyId", "id") ON DELETE CASCADE;
ALTER TABLE "production_order_workers" ADD CONSTRAINT "fk_production_order_workers_employee" FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "finished_goods" ADD CONSTRAINT "fk_finished_goods_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "finished_goods" ADD CONSTRAINT "fk_finished_goods_assembly" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "finished_goods" ADD CONSTRAINT "fk_finished_goods_productionOrder" FOREIGN KEY ("companyId", "productionOrderId") REFERENCES "production_orders" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "finished_goods" ADD CONSTRAINT "fk_finished_goods_customerOrder" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders" ("id") ON DELETE SET NULL;
ALTER TABLE "qc_checklist_items" ADD CONSTRAINT "fk_qc_checklist_items_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "qc_checks" ADD CONSTRAINT "fk_qc_checks_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "qc_checks" ADD CONSTRAINT "fk_qc_checks_finishedGood" FOREIGN KEY ("companyId", "finishedGoodId") REFERENCES "finished_goods" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "qc_check_results" ADD CONSTRAINT "fk_qc_check_results_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "qc_check_results" ADD CONSTRAINT "fk_qc_check_results_qcCheck" FOREIGN KEY ("companyId", "qcCheckId") REFERENCES "qc_checks" ("companyId", "id") ON DELETE CASCADE;
ALTER TABLE "customer_orders" ADD CONSTRAINT "fk_customer_orders_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "customer_order_items" ADD CONSTRAINT "fk_customer_order_items_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "customer_order_items" ADD CONSTRAINT "fk_customer_order_items_customerOrder" FOREIGN KEY ("companyId", "customerOrderId") REFERENCES "customer_orders" ("companyId", "id") ON DELETE CASCADE;
ALTER TABLE "customer_order_items" ADD CONSTRAINT "fk_customer_order_items_assembly" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_order_items" ADD CONSTRAINT "fk_customer_order_items_productionOrder" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders" ("id") ON DELETE SET NULL;
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments_customerOrder" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders" ("id") ON DELETE SET NULL;
ALTER TABLE "shipment_items" ADD CONSTRAINT "fk_shipment_items_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "shipment_items" ADD CONSTRAINT "fk_shipment_items_shipment" FOREIGN KEY ("companyId", "shipmentId") REFERENCES "shipments" ("companyId", "id") ON DELETE CASCADE;
ALTER TABLE "shipment_items" ADD CONSTRAINT "fk_shipment_items_finishedGood" FOREIGN KEY ("companyId", "finishedGoodId") REFERENCES "finished_goods" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_supplier" FOREIGN KEY ("supplierId") REFERENCES "suppliers" ("id") ON DELETE SET NULL;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_sourceCustomerOrder" FOREIGN KEY ("sourceCustomerOrderId") REFERENCES "customer_orders" ("id") ON DELETE SET NULL;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "fk_purchase_order_items_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "fk_purchase_order_items_purchaseOrder" FOREIGN KEY ("companyId", "purchaseOrderId") REFERENCES "purchase_orders" ("companyId", "id") ON DELETE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "fk_purchase_order_items_product" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE SET NULL;
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "payroll_entries" ADD CONSTRAINT "fk_payroll_entries_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "payroll_entries" ADD CONSTRAINT "fk_payroll_entries_employee" FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees" ("companyId", "id") ON DELETE RESTRICT;
ALTER TABLE "payroll_entries" ADD CONSTRAINT "fk_payroll_entries_productionOrder" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders" ("id") ON DELETE SET NULL;
ALTER TABLE "company_settings" ADD CONSTRAINT "fk_company_settings_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "company_branding" ADD CONSTRAINT "fk_company_branding_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "company_ai_settings" ADD CONSTRAINT "fk_company_ai_settings_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "pending_ai_actions" ADD CONSTRAINT "fk_pending_ai_actions_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "fk_ai_usage_logs_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "fk_company_subscriptions_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "fk_company_subscriptions_plan" FOREIGN KEY ("planId") REFERENCES "plans" ("id") ON DELETE RESTRICT;
ALTER TABLE "legacy_migration_runs" ADD CONSTRAINT "fk_legacy_migration_runs_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;
