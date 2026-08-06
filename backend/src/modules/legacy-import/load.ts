import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { TransformedImportGraph } from './transform';

/**
 * Load stage — adapted from migration-toolkit/src/load.ts's `loadCompanyGraph`
 * (see that file's header comment for the general design). The real
 * difference here: this writes into the CALLER'S OWN EXISTING company
 * (`ctx.companyId`), so there is no `company.upsert` / `companySettings.upsert`
 * / owner `user.upsert` step at all — every write below targets a company
 * that already exists and is already the operator's own tenant, via the
 * SAME `PrismaService.runInTenantTransaction` every other NestJS module
 * uses (unlike the standalone CLI, this runs inside the real Nest app, so
 * it can use the real thing directly rather than replicating its `SET
 * LOCAL` statement by hand).
 *
 * Same idempotency conventions as the original: upsert by
 * `(companyId, legacyId)` where the schema has that unique key, `findFirst`
 * + conditional insert for child rows that don't, and an
 * existing-row-count gate for the two append-only ledgers (StockMovement,
 * AuditEvent) that have no natural per-row idempotency key at all — a
 * second import run against a company that already has ANY stock movements
 * imports zero more (flagged in the report, never silently duplicates).
 */

export interface LoadResult {
  counts: Record<string, number>;
  skippedLedgers: string[];
}

export async function loadImportGraph(
  prisma: PrismaService,
  companyId: string,
  actorUserId: string,
  graph: TransformedImportGraph,
): Promise<LoadResult> {
  const counts: Record<string, number> = {};
  const skippedLedgers: string[] = [];

  await prisma.runInTenantTransaction({ companyId, userId: actorUserId }, async (tx) => {
    // --- CompanyUnit (ad hoc units this run needs beyond what already exists) ---
    for (const unit of graph.newUnits) {
      await tx.companyUnit.upsert({
        where: { companyId_name: { companyId, name: unit.name } },
        create: { id: unit.id, companyId, name: unit.name },
        update: {},
      });
    }
    counts.newUnits = graph.newUnits.length;

    // --- Suppliers ---
    for (const s of graph.suppliers) {
      await tx.supplier.upsert({
        where: { companyId_legacyId: { companyId, legacyId: s.legacyId } },
        create: { id: s.id, companyId, legacyId: s.legacyId, name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email, notes: s.notes, createdAt: s.createdAt },
        update: { name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email, notes: s.notes },
      });
    }
    counts.suppliers = graph.suppliers.length;

    // --- Products ---
    for (const p of graph.products) {
      if (!p.unitId) continue; // already warned during transform — cannot load without the required FK
      await tx.product.upsert({
        where: { companyId_legacyId: { companyId, legacyId: p.legacyId } },
        create: { id: p.id, companyId, ...productFields(p) },
        update: productFields(p),
      });
    }
    counts.products = graph.products.filter((p) => p.unitId).length;

    // --- Warehouses ---
    for (const w of graph.warehouses) {
      await tx.warehouse.upsert({
        where: { companyId_legacyId: { companyId, legacyId: w.legacyId } },
        create: { id: w.id, companyId, legacyId: w.legacyId, name: w.name, isDefault: w.isDefault, createdAt: w.createdAt },
        update: { name: w.name, isDefault: w.isDefault },
      });
    }
    counts.warehouses = graph.warehouses.length;

    // --- Assemblies ---
    for (const a of graph.assemblies) {
      await tx.assembly.upsert({
        where: { companyId_legacyId: { companyId, legacyId: a.legacyId } },
        create: { id: a.id, companyId, legacyId: a.legacyId, name: a.name, article: a.article, note: a.note, laborCostPerUnit: a.laborCostPerUnit, packagingCostPerUnit: a.packagingCostPerUnit, deliveryCostPerUnit: a.deliveryCostPerUnit, otherCostPerUnit: a.otherCostPerUnit, defaultSupplierId: a.defaultSupplierId, createdAt: a.createdAt },
        update: { name: a.name, article: a.article, note: a.note, laborCostPerUnit: a.laborCostPerUnit, packagingCostPerUnit: a.packagingCostPerUnit, deliveryCostPerUnit: a.deliveryCostPerUnit, otherCostPerUnit: a.otherCostPerUnit },
      });
    }
    counts.assemblies = graph.assemblies.length;

    // AssemblyComponent (current BOM) — no legacyId, full replace per run (same reasoning as the original loader: no stable per-row identity to upsert against).
    const assemblyIdsThisRun = graph.assemblies.map((a) => a.id);
    if (assemblyIdsThisRun.length > 0) {
      await tx.assemblyComponent.deleteMany({ where: { companyId, assemblyId: { in: assemblyIdsThisRun } } });
    }
    if (graph.assemblyComponents.length > 0) {
      await tx.assemblyComponent.createMany({
        data: graph.assemblyComponents.map((c) => ({ id: c.id, companyId, assemblyId: c.assemblyId, componentType: c.componentType, productId: c.productId, subAssemblyId: c.subAssemblyId, warehouseId: c.warehouseId, qtyPerUnit: c.qtyPerUnit })),
      });
    }
    counts.assemblyComponents = graph.assemblyComponents.length;

    // AssemblyVersion — immutable/append-only, but @@unique([assemblyId, versionNumber]) is a natural idempotency key.
    for (const v of graph.assemblyVersions) {
      const existing = await tx.assemblyVersion.findUnique({ where: { assemblyId_versionNumber: { assemblyId: v.assemblyId, versionNumber: v.versionNumber } } });
      const versionId = existing?.id ?? v.id;
      if (!existing) {
        await tx.assemblyVersion.create({ data: { id: v.id, companyId, assemblyId: v.assemblyId, versionNumber: v.versionNumber, createdById: actorUserId, createdAt: v.createdAt } });
      }
      if (!existing && v.components.length > 0) {
        await tx.assemblyVersionComponent.createMany({
          data: v.components.map((c) => ({ id: randomUUID(), companyId, assemblyVersionId: versionId, componentType: c.componentType, productId: c.productId, subAssemblyId: c.subAssemblyId, warehouseId: c.warehouseId, qtyPerUnit: c.qtyPerUnit })),
        });
      }
    }
    counts.assemblyVersions = graph.assemblyVersions.length;

    // --- WarehouseStock — @@unique([companyId, productId, warehouseId]) is the natural idempotency key. ---
    for (const ws of graph.warehouseStock) {
      await tx.warehouseStock.upsert({
        where: { companyId_productId_warehouseId: { companyId, productId: ws.productId, warehouseId: ws.warehouseId } },
        create: { id: ws.id, companyId, productId: ws.productId, warehouseId: ws.warehouseId, qty: ws.qty },
        update: { qty: ws.qty },
      });
    }
    counts.warehouseStock = graph.warehouseStock.length;

    // --- CustomerOrders + Items ---
    for (const co of graph.customerOrders) {
      await tx.customerOrder.upsert({
        where: { companyId_legacyId: { companyId, legacyId: co.legacyId } },
        create: { id: co.id, companyId, legacyId: co.legacyId, orderNumber: co.orderNumber, clientName: co.clientName, contactPerson: co.contactPerson, deadline: co.deadline, priority: co.priority as never, status: co.status as never, comment: co.comment, createdById: actorUserId, createdAt: co.createdAt },
        update: { status: co.status as never, comment: co.comment },
      });
    }
    counts.customerOrders = graph.customerOrders.length;

    for (const item of graph.customerOrderItems) {
      const existing = await tx.customerOrderItem.findFirst({ where: { companyId, customerOrderId: item.customerOrderId, assemblyId: item.assemblyId, qty: item.qty } });
      if (!existing) {
        await tx.customerOrderItem.create({ data: { id: item.id, companyId, customerOrderId: item.customerOrderId, assemblyId: item.assemblyId, qty: item.qty } });
      }
    }
    counts.customerOrderItems = graph.customerOrderItems.length;

    // --- StockMovement + AuditEvent — append-only ledgers, no per-row idempotency key: only inserted when the company has zero existing rows of that type. ---
    const existingMovementCount = await tx.stockMovement.count({ where: { companyId } });
    if (existingMovementCount === 0 && graph.stockMovements.length > 0) {
      await tx.stockMovement.createMany({
        data: graph.stockMovements.map((m) => ({ id: m.id, companyId, productId: m.productId, type: m.type as never, qtyDelta: m.qtyDelta, qtyAfter: m.qtyAfter, comment: m.comment, createdAt: m.createdAt })),
      });
      counts.stockMovements = graph.stockMovements.length;
    } else {
      counts.stockMovements = 0;
      if (existingMovementCount > 0 && graph.stockMovements.length > 0) skippedLedgers.push('stockMovements');
    }

    const existingAuditCount = await tx.auditEvent.count({ where: { companyId } });
    if (existingAuditCount === 0 && graph.auditEvents.length > 0) {
      await tx.auditEvent.createMany({
        data: graph.auditEvents.map((a) => ({ id: a.id, companyId, action: a.action, entityType: a.entityType, entityId: a.entityId ?? companyId, metadata: a.metadata as never, createdAt: a.createdAt })),
      });
      counts.auditEvents = graph.auditEvents.length;
    } else {
      counts.auditEvents = 0;
      if (existingAuditCount > 0 && graph.auditEvents.length > 0) skippedLedgers.push('auditEvents');
    }
  });

  return { counts, skippedLedgers };
}

function productFields(p: TransformedImportGraph['products'][number]) {
  return {
    legacyId: p.legacyId, article: p.article, code: p.code, name: p.name, description: p.description,
    category: p.category, productGroup: p.productGroup, family: p.family, type: p.type, kind: p.kind,
    productLine: p.productLine, barcode: p.barcode, unitId: p.unitId, unitsPerPackage: p.unitsPerPackage,
    cell: p.cell, qty: p.qty, minQty: p.minQty,
    localPriceExclVat: p.localPriceExclVat, localPriceInclVat: p.localPriceInclVat,
    germanPriceExclVat: p.germanPriceExclVat, germanPriceInclVat: p.germanPriceInclVat, sellPriceEur: p.sellPriceEur,
    weightPerUnitKg: p.weightPerUnitKg, warrantyMonths: p.warrantyMonths, status: p.status,
    manufacturer: p.manufacturer, manufacturerCode: p.manufacturerCode, countryOfOrigin: p.countryOfOrigin,
    priceListRef: p.priceListRef, note: p.note, defaultSupplierId: p.defaultSupplierId,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}
