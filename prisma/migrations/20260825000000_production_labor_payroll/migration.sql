-- Migration: production_labor_payroll (2026-08-25)
--
-- Incremental, confirmable execution-recording layer for piecework labor,
-- replacing the old one-shot PayrollEntry generation in
-- ProductionOrdersService#start() (removed in this release, application
-- code only — no schema change needed for that removal).
--
-- Deliberately NOT introducing a new "labor fund" field anywhere:
-- ProductionOrder.laborCostEur already IS that fund (Assembly.laborCostPerUnit
-- x unitsPlanned, frozen once at start(), see that method's own "Cost
-- freezing" comment) — every PRODUCT-kind ProductionExecution references
-- productionOrders directly and checks its confirmed executions' totals
-- against that existing column, application-side.
--
-- Tables:
--   work_tasks                     — GENERAL work only (no ProductionOrder to attach to); fund set manually
--   work_task_items                — informational tag "this general work touched product X", never read by any fund/allocation math
--   production_executions          — one recorded event (date, qty, method, allocation mode); exactly one of productionOrderId/workTaskId set (CHECK below)
--   production_execution_allocations — per-employee share of one execution's totalAmount
--   teams / team_members           — organizational presets only, never a payroll unit (current roster, not historized)
--   payroll_periods                — accounting freeze; closes create/confirm/void for executions and manual PayrollEntry rows dated inside it
--
-- Existing tables touched (additive only):
--   assemblies.soloAllowed              — new column, default true, preserves current behavior for every existing row
--   payroll_entries.sourceAllocationId  — new nullable column, traces a PIECEWORK ledger row back to the allocation that generated it (null for every pre-existing row and for manual ADVANCE/BONUS/PENALTY entries)
--   customer_order_items                — new @@unique(companyId, id) composite-FK target, required for work_task_items' required composite relation (Phase 3 review decision 4 convention); purely additive index, no data change
--
-- FK shapes (mirrors existing composite/single-column conventions exactly —
-- see schema.prisma header §cross-tenant):
--   work_tasks.companyId                          -> companies(id)                                    plain, RESTRICT
--   work_task_items.(companyId,workTaskId)         -> work_tasks(companyId,id)                         composite, CASCADE
--   work_task_items.(companyId,customerOrderItemId)-> customer_order_items(companyId,id)               composite, CASCADE
--   production_executions.companyId               -> companies(id)                                    plain, RESTRICT
--   production_executions.productionOrderId       -> production_orders(id)                            plain, SET NULL (optional — Prisma composite-optional limitation, app-layer tenant check via Prisma Client Extension)
--   production_executions.workTaskId               -> work_tasks(id)                                   plain, SET NULL (optional, same reason)
--   production_executions.teamId                   -> teams(id)                                        plain, SET NULL (optional, reporting tag only)
--   production_executions.supersedesId             -> production_executions(id)                        plain, SET NULL (self-relation, correction chain)
--   production_execution_allocations.(companyId,executionId) -> production_executions(companyId,id)    composite, CASCADE
--   production_execution_allocations.(companyId,employeeId)  -> employees(companyId,id)                composite, RESTRICT
--   payroll_entries.sourceAllocationId             -> production_execution_allocations(id)              plain, SET NULL (optional, one-to-one via unique)
--   team_members.(companyId,teamId)                -> teams(companyId,id)                              composite, CASCADE
--   team_members.(companyId,employeeId)            -> employees(companyId,id)                          composite, RESTRICT
--   payroll_periods.companyId                      -> companies(id)                                    plain, RESTRICT
--
-- CHECK constraint (new for this migration, no prior precedent in this
-- schema for an XOR-shaped pair — Prisma's schema DSL has no native
-- construct for this, so it's added here as raw SQL): exactly one of
-- production_executions.productionOrderId / workTaskId must be set. This is
-- the single database-level guarantee that a PRODUCT execution can never
-- accidentally also draw against a GENERAL fund (or vice versa).
--
-- RLS: ENABLE + FORCE + tenant_isolation policy on every new table,
-- identical pattern to every other tenant-scoped table in this schema.
--
-- GRANT to app_service, guarded by IF EXISTS — same reasoning as every
-- other Finance-era migration's own GRANT block (production's real
-- DATABASE_URL role is app_service; local dev/CI have no such role, connect
-- as app_user, a superuser there, needing no grant).
--
-- NOTE ON UNRELATED DRIFT (disclosed, not silently absorbed): running
-- `prisma migrate diff` against the full existing migration history surfaced
-- pre-existing schema drift unrelated to this change — DROP/ADD of several
-- foreign keys on import_connections/import_jobs/landing_page_versions/
-- super_admin_refresh_tokens/supplier_portal_refresh_tokens/
-- supplier_portal_users, a DROP INDEX on purchase_order_items, an index
-- rename on stock_reservations, and `ALTER COLUMN id DROP DEFAULT` on ~20
-- unrelated tables. None of that is included here — it predates this
-- session and is out of scope for a production-labor migration. Flagged
-- separately in the implementation report rather than bundled in silently.

CREATE TYPE "WorkTaskStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "ProductionExecutionMethod" AS ENUM ('SOLO', 'TEAM', 'MULTI_WORKER');
CREATE TYPE "ExecutionAllocationMode" AS ENUM ('PERCENT', 'HOURS');
CREATE TYPE "ProductionExecutionStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'VOIDED');
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- ---------------------------------------------------------------------
-- Existing tables — additive columns/index only
-- ---------------------------------------------------------------------

ALTER TABLE "assemblies" ADD COLUMN "soloAllowed" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "payroll_entries" ADD COLUMN "sourceAllocationId" UUID;

CREATE UNIQUE INDEX "customer_order_items_companyId_id_key" ON "customer_order_items"("companyId", "id");

-- ---------------------------------------------------------------------
-- teams / team_members
-- ---------------------------------------------------------------------

CREATE TABLE "teams" (
    "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "name"      TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "teams_companyId_id_key" ON "teams"("companyId", "id");
CREATE INDEX "teams_companyId_idx" ON "teams"("companyId");

ALTER TABLE "teams" ADD CONSTRAINT "teams_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON teams
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

CREATE TABLE "team_members" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"  UUID NOT NULL,
    "teamId"     UUID NOT NULL,
    "employeeId" UUID NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_members_teamId_employeeId_key" ON "team_members"("teamId", "employeeId");
CREATE INDEX "team_members_companyId_idx" ON "team_members"("companyId");

ALTER TABLE "team_members" ADD CONSTRAINT "team_members_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_companyId_teamId_fkey" FOREIGN KEY ("companyId", "teamId") REFERENCES "teams"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_companyId_employeeId_fkey" FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON team_members
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- work_tasks / work_task_items  (GENERAL work only)
-- ---------------------------------------------------------------------

CREATE TABLE "work_tasks" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"   UUID NOT NULL,
    "title"       TEXT NOT NULL,
    "fund"        DECIMAL(14,2) NOT NULL,
    "status"      "WorkTaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" UUID NOT NULL,
    "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_tasks_companyId_id_key" ON "work_tasks"("companyId", "id");
CREATE INDEX "work_tasks_companyId_idx" ON "work_tasks"("companyId");

ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE work_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_tasks
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

CREATE TABLE "work_task_items" (
    "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"           UUID NOT NULL,
    "workTaskId"          UUID NOT NULL,
    "customerOrderItemId" UUID NOT NULL,

    CONSTRAINT "work_task_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_task_items_workTaskId_customerOrderItemId_key" ON "work_task_items"("workTaskId", "customerOrderItemId");
CREATE INDEX "work_task_items_companyId_idx" ON "work_task_items"("companyId");

ALTER TABLE "work_task_items" ADD CONSTRAINT "work_task_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_task_items" ADD CONSTRAINT "work_task_items_companyId_workTaskId_fkey" FOREIGN KEY ("companyId", "workTaskId") REFERENCES "work_tasks"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_task_items" ADD CONSTRAINT "work_task_items_companyId_customerOrderItemId_fkey" FOREIGN KEY ("companyId", "customerOrderItemId") REFERENCES "customer_order_items"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE work_task_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_task_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_task_items
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- production_executions / production_execution_allocations
-- ---------------------------------------------------------------------

CREATE TABLE "production_executions" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"         UUID NOT NULL,
    "productionOrderId" UUID,
    "workTaskId"        UUID,
    "performedAt"       TIMESTAMPTZ(3) NOT NULL,
    "qtyCompleted"      DECIMAL(14,3),
    "method"            "ProductionExecutionMethod" NOT NULL,
    "teamId"            UUID,
    "allocationMode"    "ExecutionAllocationMode" NOT NULL,
    "totalAmount"       DECIMAL(14,2) NOT NULL,
    "status"            "ProductionExecutionStatus" NOT NULL DEFAULT 'DRAFT',
    "recordedById"      UUID NOT NULL,
    "confirmedById"     UUID,
    "confirmedAt"       TIMESTAMPTZ(3),
    "note"              TEXT,
    "supersedesId"      UUID,
    "createdAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "production_executions_exactly_one_parent" CHECK (
      (("productionOrderId" IS NOT NULL)::int + ("workTaskId" IS NOT NULL)::int) = 1
    )
);

CREATE UNIQUE INDEX "production_executions_companyId_id_key" ON "production_executions"("companyId", "id");
CREATE UNIQUE INDEX "production_executions_supersedesId_key" ON "production_executions"("supersedesId");
CREATE INDEX "production_executions_companyId_productionOrderId_idx" ON "production_executions"("companyId", "productionOrderId");
CREATE INDEX "production_executions_companyId_workTaskId_idx" ON "production_executions"("companyId", "workTaskId");

ALTER TABLE "production_executions" ADD CONSTRAINT "production_executions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_executions" ADD CONSTRAINT "production_executions_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "production_executions" ADD CONSTRAINT "production_executions_workTaskId_fkey" FOREIGN KEY ("workTaskId") REFERENCES "work_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "production_executions" ADD CONSTRAINT "production_executions_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "production_executions" ADD CONSTRAINT "production_executions_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "production_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE production_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON production_executions
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

CREATE TABLE "production_execution_allocations" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"   UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "employeeId"  UUID NOT NULL,
    "percent"     DECIMAL(5,2),
    "hours"       DECIMAL(6,2),
    "amount"      DECIMAL(14,2) NOT NULL,

    CONSTRAINT "production_execution_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_execution_allocations_executionId_employeeId_key" ON "production_execution_allocations"("executionId", "employeeId");
CREATE INDEX "production_execution_allocations_companyId_idx" ON "production_execution_allocations"("companyId");

ALTER TABLE "production_execution_allocations" ADD CONSTRAINT "production_execution_allocations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_execution_allocations" ADD CONSTRAINT "production_execution_allocations_companyId_executionId_fkey" FOREIGN KEY ("companyId", "executionId") REFERENCES "production_executions"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_execution_allocations" ADD CONSTRAINT "production_execution_allocations_companyId_employeeId_fkey" FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE production_execution_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_execution_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON production_execution_allocations
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- payroll_entries.sourceAllocationId — added after production_execution_allocations exists
CREATE UNIQUE INDEX "payroll_entries_sourceAllocationId_key" ON "payroll_entries"("sourceAllocationId");
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_sourceAllocationId_fkey" FOREIGN KEY ("sourceAllocationId") REFERENCES "production_execution_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- payroll_periods
-- ---------------------------------------------------------------------

CREATE TABLE "payroll_periods" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"   UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd"   TIMESTAMPTZ(3) NOT NULL,
    "status"      "PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedById"  UUID,
    "closedAt"    TIMESTAMPTZ(3),
    "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_periods_companyId_periodStart_periodEnd_idx" ON "payroll_periods"("companyId", "periodStart", "periodEnd");

ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_periods
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, see header comment
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON teams, team_members, work_tasks, work_task_items, production_executions, production_execution_allocations, payroll_periods TO app_service';
  END IF;
END
$$;
