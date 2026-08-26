-- "Зі складу" claims from the order-creation "Підвироби" dialog — see
-- SubAssemblyReservation's schema comment for the full rationale.

CREATE TABLE "sub_assembly_reservations" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"       UUID NOT NULL,
    "assemblyId"      UUID NOT NULL,
    "customerOrderId" UUID NOT NULL,
    "qty"             DECIMAL(14,3) NOT NULL DEFAULT 0,
    "createdById"     UUID NOT NULL,
    "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sub_assembly_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sub_assembly_reservations_companyId_customerOrderId_assemb_key" ON "sub_assembly_reservations"("companyId", "customerOrderId", "assemblyId");
CREATE INDEX "sub_assembly_reservations_companyId_assemblyId_idx" ON "sub_assembly_reservations"("companyId", "assemblyId");
CREATE INDEX "sub_assembly_reservations_companyId_customerOrderId_idx" ON "sub_assembly_reservations"("companyId", "customerOrderId");

ALTER TABLE "sub_assembly_reservations" ADD CONSTRAINT "sub_assembly_reservations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sub_assembly_reservations" ADD CONSTRAINT "sub_assembly_reservations_companyId_assemblyId_fkey" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sub_assembly_reservations" ADD CONSTRAINT "sub_assembly_reservations_companyId_customerOrderId_fkey" FOREIGN KEY ("companyId", "customerOrderId") REFERENCES "customer_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE sub_assembly_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_assembly_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sub_assembly_reservations
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, see header comment
-- in other migrations for why (local dev/CI have no app_service role)
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON sub_assembly_reservations TO app_service';
  END IF;
END
$$;
