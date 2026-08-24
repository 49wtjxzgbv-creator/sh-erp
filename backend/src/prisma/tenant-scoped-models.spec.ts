import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_MODELS } from './tenant-scoped-models';

/**
 * Real production incident (2026-08-21): `SupplierPortalUser` stayed in
 * this list after the ADR-0012 migration dropped its `companyId` column
 * (the model became global, no RLS). `tenantScopingExtension` kept
 * unconditionally injecting `companyId` into every `prisma.tenant.
 * supplierPortalUser` call, so `SuppliersService.invitePortal()` broke —
 * "Unknown argument `companyId`" — for every branch, live, for hours,
 * completely unnoticed because every unit test mocks Prisma directly
 * (bypassing the real extension) and no test ever cross-checked this list
 * against the actual schema. This test is that cross-check, permanently.
 */
describe('TENANT_SCOPED_MODELS', () => {
  const modelsByName = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

  it('is not empty (sanity check that the DMMF/list themselves loaded)', () => {
    expect(TENANT_SCOPED_MODELS.size).toBeGreaterThan(0);
  });

  it.each([...TENANT_SCOPED_MODELS])('%s exists in the schema and still carries a companyId column', (modelName) => {
    const model = modelsByName.get(modelName);
    expect(model).toBeDefined();
    const fieldNames = model!.fields.map((f) => f.name);
    expect(fieldNames).toContain('companyId');
  });

  /**
   * The reverse direction of the check above — real production incident
   * (2026-08-24): 7 new models (production-labor module) were added to
   * schema.prisma with a `companyId` column but never added to this list,
   * so `tenantScopingExtension` never stamped `companyId` on their writes
   * at all. Every create against them failed outright in production
   * ("Argument `company` is missing") — caught only by live manual testing
   * after deploy, not by this test suite, because it only ever checked
   * "everything IN the list is valid," never "everything that SHOULD be in
   * the list actually is." This is that missing direction, permanently.
   */
  it('every schema model with a companyId column is present in TENANT_SCOPED_MODELS', () => {
    const missing = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === 'companyId'))
      .map((m) => m.name)
      .filter((name) => !TENANT_SCOPED_MODELS.has(name));
    expect(missing).toEqual([]);
  });
});
