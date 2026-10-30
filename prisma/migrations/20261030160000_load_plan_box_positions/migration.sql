-- CreateTable
-- Manual drag positioning (2026-10-30) — one row per physical box a human
-- has dragged to a specific spot in the 3D load-plan view.
CREATE TABLE "load_plan_box_positions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "loadPlanItemId" UUID NOT NULL,
    "boxIndex" INTEGER NOT NULL,
    "xCm" DECIMAL(8,2) NOT NULL,
    "yCm" DECIMAL(8,2) NOT NULL,
    "zCm" DECIMAL(8,2) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "load_plan_box_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "load_plan_box_positions_companyId_id_key" ON "load_plan_box_positions"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "load_plan_box_positions_loadPlanItemId_boxIndex_key" ON "load_plan_box_positions"("loadPlanItemId", "boxIndex");

-- AddForeignKey
ALTER TABLE "load_plan_box_positions" ADD CONSTRAINT "load_plan_box_positions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_plan_box_positions" ADD CONSTRAINT "load_plan_box_positions_companyId_loadPlanItemId_fkey" FOREIGN KEY ("companyId", "loadPlanItemId") REFERENCES "load_plan_items"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Row Level Security — tenant_isolation policy (ADR-0002 pattern,
-- identical to every other new company-scoped table).
-- ---------------------------------------------------------------------

ALTER TABLE load_plan_box_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE load_plan_box_positions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON load_plan_box_positions
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, local dev/CI have
-- no app_service role at all.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON load_plan_box_positions TO app_service';
  END IF;
END
$$;
