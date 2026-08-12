-- Defense-in-depth for a real production incident: application-level
-- checks (WarehousesService#seedDefault/clearExistingDefault) could still
-- race under concurrent requests. A partial unique index makes "two
-- default warehouses for the same company" impossible at the database
-- level regardless of what application code path gets there.
CREATE UNIQUE INDEX "warehouses_company_default_unique"
  ON "warehouses" ("companyId")
  WHERE "isDefault" = true AND "deletedAt" IS NULL;
