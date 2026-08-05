import { Prisma } from '@prisma/client';
import { getTenantContext } from './tenant-context';
import { TENANT_SCOPED_MODELS } from './tenant-scoped-models';

const WRITE_ACTIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
]);

const READ_OR_DELETE_ACTIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * App-layer half of the two-layer tenant isolation described in ADR-0002 and
 * Phase 2 §11.4 — the other half is the Postgres RLS policy applied via raw
 * SQL migration (database-schema.md §2). This extension:
 *
 *   1. Auto-injects `companyId: <current tenant>` into every tenant-scoped
 *      model's `where` clause, so a handler can never accidentally read
 *      across tenants just by forgetting a filter.
 *   2. Auto-stamps `companyId` onto every `create`/`upsert` payload for a
 *      tenant-scoped model, so a handler can never accidentally write a row
 *      for the wrong tenant.
 *   3. If a caller explicitly passes a *different* companyId (in `where` or
 *      in create/update `data`), this throws rather than silently
 *      overwriting it — an explicit mismatch is far more likely to be a bug
 *      than an intentional cross-tenant operation, and RLS would reject the
 *      write anyway (FORCE ROW LEVEL SECURITY), but failing here gives a
 *      much clearer error than a raw Postgres permission-denied.
 *
 * Known limitation, disclosed rather than hidden (see the Phase 3
 * architecture review, decision 4): this extension only guarantees the
 * *entry-point* row's companyId is correct. It does NOT — and structurally
 * cannot — validate that a nested relation write's target already belongs
 * to the same tenant; that guarantee comes from the composite
 * `(companyId, id)` foreign keys now on 25 relations in the schema, which
 * make a cross-tenant link a hard database error instead of a silent bug.
 */
export function tenantScopingExtension() {
  return Prisma.defineExtension({
    name: 'tenant-scoping',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const { companyId } = getTenantContext();
          const a = args as Record<string, any>;

          if (READ_OR_DELETE_ACTIONS.has(operation)) {
            a.where = injectCompanyId(a.where, companyId, model, operation);
          }

          if (WRITE_ACTIONS.has(operation)) {
            if (operation === 'createMany' && Array.isArray(a.data)) {
              a.data = a.data.map((row: Record<string, any>) =>
                stampCompanyId(row, companyId, model),
              );
            } else if (a.data) {
              a.data = stampCompanyId(a.data, companyId, model);
            }
            if (operation === 'upsert' && a.create) {
              a.create = stampCompanyId(a.create, companyId, model);
              a.where = injectCompanyId(a.where, companyId, model, operation);
            }
          }

          return query(a);
        },
      },
    },
  });
}

function injectCompanyId(
  where: Record<string, any> | undefined,
  companyId: string,
  model: string,
  operation: string,
): Record<string, any> {
  const w = where ?? {};
  if (w.companyId !== undefined && w.companyId !== companyId) {
    throw new Error(
      `Tenant mismatch on ${model}.${operation}: query explicitly filtered on a ` +
        `different companyId than the current request's tenant context. This is ` +
        `almost always a bug — if a genuine cross-tenant admin operation is needed, ` +
        `it must go through a dedicated, audited superadmin code path, not the ` +
        `normal tenant-scoped Prisma client.`,
    );
  }
  return { ...w, companyId };
}

function stampCompanyId(
  data: Record<string, any>,
  companyId: string,
  model: string,
): Record<string, any> {
  if (data.companyId !== undefined && data.companyId !== companyId) {
    throw new Error(
      `Tenant mismatch on ${model} write: payload explicitly set a different ` +
        `companyId than the current request's tenant context.`,
    );
  }
  return { ...data, companyId };
}
