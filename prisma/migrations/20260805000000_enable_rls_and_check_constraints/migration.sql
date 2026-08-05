-- Row-Level Security policies + immutability grants + permanent CHECK constraints
-- ("SH ERP v2 - Phase 3 Database Schema.md" section 2 / 2b, the exact SQL that
-- document specifies). Written for real during the production-readiness pass --
-- until now this only existed as prose in the design doc, never as a runnable
-- migration file, which meant the two-layer tenant isolation (ADR-0002) was only
-- ever half-real: the app-layer Prisma Client Extension was live, but the
-- database-layer RLS backstop it's supposed to pair with had never actually been
-- applied to a real database. Run this AFTER the baseline schema migration
-- (prisma/migrations/20260803000000_init, which creates every table this file
-- ALTERs) and BEFORE `app_user` is used against a production database.
--
-- Prerequisite, repeated from the design doc and backend/README.md: `app_user`
-- (the role the NestJS app connects as) must NOT be a superuser and must NOT have
-- BYPASSRLS -- FORCE ROW LEVEL SECURITY only blocks the table OWNER's connections
-- from bypassing RLS, a superuser bypasses it regardless of FORCE. Verify this
-- explicitly as a provisioning-runbook checklist item, never assume it.
--
-- COLUMN-NAMING FIX (production-readiness / deployment-documentation pass,
-- same pass that added the 20260803000000_init baseline migration): this file
-- originally referenced snake_case columns (company_id, product_id, ...), an
-- incorrect assumption. schema.prisma has @@map() on every model (table names)
-- but deliberately NO @map() on individual fields, so Prisma's real generated
-- column names are the exact camelCase field names, quoted to preserve case
-- (e.g. "companyId", not company_id). As originally written, every statement in
-- this file would have failed with "column ... does not exist" against a real
-- Prisma-migrated database. Corrected here to reference the real column names;
-- table names were already correct (they do go through @@map).

-- 42 tenant-scoped tables (every model in schema.prisma with a
-- `companyId` field), generated from the schema itself rather than hand-typed,
-- to avoid the exact kind of silent-omission bug this whole gap already was.

ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_memberships
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refresh_tokens
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE company_feature_flag_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_feature_flag_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_feature_flag_overrides
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE file_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON file_assets
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE company_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_units FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_units
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suppliers
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warehouses
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE warehouse_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_stock FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warehouse_stock
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_movements
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE inventory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_sessions
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_items
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE assemblies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assemblies
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE assembly_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE assembly_components FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assembly_components
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE assembly_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assembly_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assembly_versions
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE assembly_version_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE assembly_version_components FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assembly_version_components
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE production_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_stages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON production_stages
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON production_orders
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE production_order_pick_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_order_pick_list_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON production_order_pick_list_items
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE production_order_stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_order_stage_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON production_order_stage_events
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE production_order_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_order_workers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON production_order_workers
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE finished_goods ENABLE ROW LEVEL SECURITY;
ALTER TABLE finished_goods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finished_goods
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE qc_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qc_checklist_items
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE qc_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qc_checks
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE qc_check_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_check_results FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qc_check_results
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE customer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_orders
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE customer_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_order_items
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shipments
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shipment_items
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_orders
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_items
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employees
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_entries
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_settings
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE company_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_branding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_branding
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE company_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_ai_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_ai_settings
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE pending_ai_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_ai_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pending_ai_actions
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_usage_logs
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_subscriptions
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE legacy_migration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_migration_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legacy_migration_runs
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- Immutability grants (schema.prisma's own header comment: "Append-only ledgers
-- ... are never soft-deleted -- they are immutable by design ... now enforced by
-- a DB grant rather than by omission"). `app_user` below is the role name this
-- backend's DATABASE_URL connects as (see backend/.env.example) -- update if a
-- different role name is used in a given environment.
REVOKE UPDATE, DELETE ON audit_events, stock_movements, assembly_versions,
  payroll_entries, production_order_stage_events FROM app_user;

-- Permanent business-invariant CHECK constraints (decision 2 -- deliberately
-- narrow scope, see the design doc for why broader constraints like
-- non-negative quantities were NOT added here).
ALTER TABLE assembly_components ADD CONSTRAINT assembly_component_type_consistency
  CHECK (
    ("componentType" = 'PRODUCT'  AND "productId" IS NOT NULL AND "subAssemblyId" IS NULL) OR
    ("componentType" = 'ASSEMBLY' AND "subAssemblyId" IS NOT NULL AND "productId" IS NULL)
  );

ALTER TABLE assembly_version_components ADD CONSTRAINT assembly_version_component_type_consistency
  CHECK (
    ("componentType" = 'PRODUCT'  AND "productId" IS NOT NULL AND "subAssemblyId" IS NULL) OR
    ("componentType" = 'ASSEMBLY' AND "subAssemblyId" IS NOT NULL AND "productId" IS NULL)
  );

ALTER TABLE assembly_components ADD CONSTRAINT assembly_component_no_self_reference
  CHECK ("assemblyId" <> "subAssemblyId");
