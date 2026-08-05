import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { TransformedCompanyGraph } from './transform';

/**
 * Stage 3 — Load (Phase 4 design doc §2.3). Writes the transformed,
 * in-memory object graph to Postgres inside a SINGLE database transaction
 * per company migration run — an all-or-nothing guarantee: a failure at
 * row 40,000 rolls back everything, never leaving a half-migrated company
 * live (§4's error-handling posture).
 *
 * RLS activation: this backend's `PrismaService.runInTenantTransaction`
 * (`backend/src/prisma/prisma.service.ts`) is the normal way every NestJS
 * module gets an RLS-activated transaction (`SET LOCAL
 * app.current_company_id` inside `$transaction`) — its own header comment
 * even names "the migration engine" as a caller that needs the same
 * guarantee outside a request lifecycle. This CLI deliberately does NOT
 * import that class directly: `PrismaService` pulls in NestJS DI decorators
 * and several other backend-internal modules (`prisma-tenant.extension`,
 * `tenant-context`, `tenant-tx-context`) that assume a running Nest
 * application context, and wiring all of that into a standalone one-shot
 * script would fight the Phase 4 design doc's own "standalone Node/
 * TypeScript CLI, decoupled from the [runtime] it's replacing" framing more
 * than it would help. Instead, `loadCompanyGraph` below replicates the
 * EXACT same `SET LOCAL app.current_company_id` statement `PrismaService`
 * issues, cited directly so the two never silently drift apart.
 *
 * NEVER EXERCISED FOR REAL IN THIS SANDBOX, disclosed rather than glossed
 * over — same standing gap as every other Prisma-touching file across this
 * whole project (no real `@prisma/client` was ever generated here, `prisma
 * generate` needs `binaries.prisma.sh`, blocked with a 403 in this
 * network sandbox). This file is real, and structurally matches the real
 * schema field-for-field (cross-checked against `prisma/schema.prisma`
 * directly while writing it), but `tsc` could not fully type-check it here
 * the way it type-checked every pure `transform/*.ts` module (which
 * deliberately import nothing from `@prisma/client` for exactly this
 * reason). Run this against a real, migrated `@prisma/client` and a real
 * disposable Postgres before trusting it for an actual company cutover —
 * this is precisely what `--dry-run` (cli.ts) is for.
 */

export interface LoadResult {
  counts: Record<string, number>;
}

export async function loadCompanyGraph(prisma: PrismaClient, graph: TransformedCompanyGraph): Promise<LoadResult> {
  const counts: Record<string, number> = {};
  const companyId = graph.company.id;

  const result = await prisma.$transaction(async (tx: PrismaClient) => {
    // Mirrors PrismaService.runInTenantTransaction exactly — see header comment.
    await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyId}'`);

    // --- Step 1: Company + owner User + CompanyMembership + CompanySettings ---
    // Upserted by `slug` (always present and unique), not `legacyId` — `legacyId` is
    // optional here (an operator running a first-time migration without a known
    // old-deployment identifier shouldn't need a sentinel value), while `slug` is a
    // real required field on every company regardless of migration status.
    await tx.company.upsert({
      where: { slug: graph.company.slug },
      create: {
        id: graph.company.id,
        name: graph.company.name,
        slug: graph.company.slug,
        timezone: graph.company.timezone,
        locale: graph.company.locale,
        legacyId: graph.company.legacyId,
      },
      update: { name: graph.company.name, timezone: graph.company.timezone, locale: graph.company.locale },
    });
    counts.company = 1;

    const argon2 = await import('argon2');
    const ownerPasswordHash = await argon2.hash(graph.owner.password);
    await tx.user.upsert({
      where: { email: graph.owner.email },
      create: { id: graph.owner.id, email: graph.owner.email, fullName: graph.owner.fullName, passwordHash: ownerPasswordHash },
      update: {},
    });

    await tx.companySettings.upsert({
      where: { companyId },
      create: { companyId },
      update: {},
    });

    // --- Step 2: CompanyUnit (must exist before any Product row, decision 1) ---
    for (const unit of graph.units) {
      await tx.companyUnit.upsert({
        where: { companyId_name: { companyId, name: unit.name } },
        create: { id: unit.id, companyId, name: unit.name },
        update: {},
      });
    }
    counts.companyUnits = graph.units.length;

    // Migrated users: User (global, idempotent by email) + CompanyMembership (idempotent by companyId+userId).
    for (const u of graph.migratedUsers) {
      await tx.user.upsert({
        where: { email: u.email },
        create: { id: u.id, email: u.email, fullName: u.fullName, login: u.login, legacyPasswordHash: u.legacyPasswordHash, active: u.active },
        update: { fullName: u.fullName, active: u.active },
      });
      const role = await tx.role.findFirst({ where: { companyId, name: u.roleName } });
      if (role) {
        await tx.companyMembership.upsert({
          where: { companyId_userId: { companyId, userId: u.id } },
          create: { companyId, userId: u.id, roleId: role.id },
          update: { roleId: role.id },
        });
      }
    }
    counts.migratedUsers = graph.migratedUsers.length;

    // --- Step 3: Suppliers, Employees, ProductionStages, QcChecklistItems ---
    for (const s of graph.suppliers) {
      await tx.supplier.upsert({
        where: { companyId_legacyId: { companyId, legacyId: s.legacyId } },
        create: { id: s.id, companyId, legacyId: s.legacyId, name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email, notes: s.notes, createdAt: s.createdAt },
        update: { name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email, notes: s.notes },
      });
    }
    counts.suppliers = graph.suppliers.length;

    for (const e of graph.employees) {
      await tx.employee.upsert({
        where: { companyId_legacyId: { companyId, legacyId: e.legacyId } },
        create: { id: e.id, companyId, legacyId: e.legacyId, fullName: e.fullName, position: e.position, phone: e.phone, hireDate: e.hireDate, status: e.status, notes: e.notes },
        update: { fullName: e.fullName, position: e.position, phone: e.phone, status: e.status, notes: e.notes },
      });
    }
    counts.employees = graph.employees.length;

    // ProductionStage/QcChecklistItem have no legacyId field and no natural unique key in this schema (Phase 4 §6 only added @@unique([companyId, legacyId]) to the 13 models that carry legacyId at all — these two don't). Idempotency fallback, disclosed: skip entirely if this company already has ANY rows of that type, rather than risk duplicating on a re-run. Imperfect (a re-run after a partial mid-step failure that already inserted SOME but was killed before finishing won't top up the rest) — flagged for the reconciliation report (verify.ts) to surface via a row-count check, not silently trusted.
    const existingStageCount = await tx.productionStage.count({ where: { companyId } });
    if (existingStageCount === 0) {
      for (const stage of graph.productionStages) {
        await tx.productionStage.create({ data: { id: stage.id, companyId, name: stage.name, sortOrder: stage.sortOrder } });
      }
    }
    counts.productionStages = existingStageCount === 0 ? graph.productionStages.length : 0;

    const existingChecklistCount = await tx.qcChecklistItem.count({ where: { companyId } });
    if (existingChecklistCount === 0) {
      for (const item of graph.qcChecklistItems) {
        await tx.qcChecklistItem.create({ data: { id: item.id, companyId, name: item.name, sortOrder: item.sortOrder } });
      }
    }
    counts.qcChecklistItems = existingChecklistCount === 0 ? graph.qcChecklistItems.length : 0;

    // --- Step 4: Product (needs unitId from step 2, defaultSupplierId from step 3) ---
    for (const p of graph.products) {
      if (!p.unitId) continue; // already warned during transform — cannot load without the required FK
      await tx.product.upsert({
        where: { companyId_legacyId: { companyId, legacyId: p.legacyId } },
        create: { id: p.id, companyId, ...productCreateFields(p) },
        update: productCreateFields(p),
      });
    }
    counts.products = graph.products.filter((p) => p.unitId).length;

    // --- Step 6a: Warehouses (needed before BOM's warehouseId resolution and before WarehouseStock) ---
    for (const w of graph.warehouses) {
      await tx.warehouse.upsert({
        where: { companyId_legacyId: { companyId, legacyId: w.legacyId } },
        create: { id: w.id, companyId, legacyId: w.legacyId, name: w.name, isDefault: w.isDefault, createdAt: w.createdAt },
        update: { name: w.name, isDefault: w.isDefault },
      });
    }
    counts.warehouses = graph.warehouses.length;

    // --- Step 5: Assembly, AssemblyComponent, AssemblyVersion + AssemblyVersionComponent ---
    for (const a of graph.assemblies) {
      await tx.assembly.upsert({
        where: { companyId_legacyId: { companyId, legacyId: a.legacyId } },
        create: { id: a.id, companyId, legacyId: a.legacyId, name: a.name, article: a.article, note: a.note, laborCostPerUnit: a.laborCostPerUnit, packagingCostPerUnit: a.packagingCostPerUnit, deliveryCostPerUnit: a.deliveryCostPerUnit, otherCostPerUnit: a.otherCostPerUnit, defaultSupplierId: a.defaultSupplierId, createdAt: a.createdAt },
        update: { name: a.name, article: a.article, note: a.note, laborCostPerUnit: a.laborCostPerUnit, packagingCostPerUnit: a.packagingCostPerUnit, deliveryCostPerUnit: a.deliveryCostPerUnit, otherCostPerUnit: a.otherCostPerUnit },
      });
    }
    counts.assemblies = graph.assemblies.length;

    // AssemblyComponent (current BOM) has no legacyId at all — Cascade-owned child of Assembly, re-created fresh each run (deleteMany + createMany) rather than upserted, since there's no stable per-row identity to upsert against and a full BOM replace is the correct semantic for "this is the assembly's current component list."
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

    // AssemblyVersion is immutable/append-only (schema's own comment) — no legacyId either, but @@unique([assemblyId, versionNumber]) IS a natural idempotency key.
    for (const v of graph.assemblyVersions) {
      const existing = await tx.assemblyVersion.findUnique({ where: { assemblyId_versionNumber: { assemblyId: v.assemblyId, versionNumber: v.versionNumber } } });
      const versionId = existing?.id ?? v.id;
      if (!existing) {
        await tx.assemblyVersion.create({ data: { id: v.id, companyId, assemblyId: v.assemblyId, versionNumber: v.versionNumber, createdById: graph.owner.id, createdAt: v.createdAt } });
      }
      if (!existing && v.components.length > 0) {
        await tx.assemblyVersionComponent.createMany({
          data: v.components.map((c) => ({ id: randomUUID(), companyId, assemblyVersionId: versionId, componentType: c.componentType, productId: c.productId, subAssemblyId: c.subAssemblyId, warehouseId: c.warehouseId, qtyPerUnit: c.qtyPerUnit })),
        });
      }
    }
    counts.assemblyVersions = graph.assemblyVersions.length;

    // --- Step 6b: WarehouseStock — @@unique([companyId, productId, warehouseId]) is the natural idempotency key. ---
    for (const ws of graph.warehouseStock) {
      await tx.warehouseStock.upsert({
        where: { companyId_productId_warehouseId: { companyId, productId: ws.productId, warehouseId: ws.warehouseId } },
        create: { id: ws.id, companyId, productId: ws.productId, warehouseId: ws.warehouseId, qty: ws.qty },
        update: { qty: ws.qty },
      });
    }
    counts.warehouseStock = graph.warehouseStock.length;

    // --- Step 8a: FinishedGoods (before ProductionOrder rows reference them, and before QcChecks/ShipmentItems) ---
    for (const fg of graph.finishedGoods) {
      if (!fg.productionOrderId || !fg.assemblyId) continue; // already warned during transform — required FKs
      await tx.finishedGood.upsert({
        where: { companyId_legacyId: { companyId, legacyId: fg.legacyId } },
        create: { id: fg.id, companyId, legacyId: fg.legacyId, serialNumber: fg.serialNumber, assemblyId: fg.assemblyId, productionOrderId: fg.productionOrderId, manufactureDate: fg.manufactureDate, status: fg.status as never, customerOrderId: fg.customerOrderId, comment: fg.comment, unitCostLocalEur: fg.unitCostLocalEur, unitCostGermanEur: fg.unitCostGermanEur, consumedInProductionOrderId: fg.consumedInProductionOrderId },
        update: { status: fg.status as never, customerOrderId: fg.customerOrderId, comment: fg.comment },
      });
    }
    counts.finishedGoods = graph.finishedGoods.filter((fg) => fg.productionOrderId && fg.assemblyId).length;

    // --- Step 7: ProductionOrder + 3 expansion tables ---
    for (const po of graph.productionOrders) {
      if (!po.assemblyId) continue; // already warned during transform
      await tx.productionOrder.upsert({
        where: { companyId_legacyId: { companyId, legacyId: po.legacyId } },
        create: {
          id: po.id, companyId, legacyId: po.legacyId, assemblyId: po.assemblyId, assemblyVersionId: po.assemblyVersionId, unitsPlanned: po.unitsPlanned,
          status: po.status as never, createdById: graph.owner.id, comment: po.comment, currentStageIndex: po.currentStageIndex,
          totalLocalCostEur: po.totalLocalCostEur, totalGermanCostEur: po.totalGermanCostEur,
          laborCostEur: po.laborCostEur, packagingCostEur: po.packagingCostEur, deliveryCostEur: po.deliveryCostEur, otherCostEur: po.otherCostEur, fullCostEur: po.fullCostEur,
          createdAt: po.createdAt, completedAt: po.completedAt,
        },
        update: { status: po.status as never, comment: po.comment, currentStageIndex: po.currentStageIndex, completedAt: po.completedAt },
      });
      // Expansion tables have no independent idempotency key — deleteMany + recreate on every run, same reasoning as AssemblyComponent above.
      await tx.productionOrderPickListItem.deleteMany({ where: { companyId, productionOrderId: po.id } });
      if (po.pickListItems.length > 0) {
        await tx.productionOrderPickListItem.createMany({
          data: po.pickListItems.map((item) => ({ id: randomUUID(), companyId, productionOrderId: po.id, productId: item.productId, description: item.description, qty: item.qty, unitPriceEur: item.unitPriceEur, lineTotalEur: item.lineTotalEur, consumedFinishedGoodIds: item.consumedFinishedGoodIds })),
        });
      }
      await tx.productionOrderStageEvent.deleteMany({ where: { companyId, productionOrderId: po.id } });
      if (po.stageEvents.length > 0) {
        await tx.productionOrderStageEvent.createMany({
          data: po.stageEvents.map((e) => ({ id: randomUUID(), companyId, productionOrderId: po.id, stageIndex: e.stageIndex, actorUserId: e.actorUserId, createdAt: e.createdAt })),
        });
      }
      await tx.productionOrderWorker.deleteMany({ where: { companyId, productionOrderId: po.id } });
      if (po.workers.length > 0) {
        await tx.productionOrderWorker.createMany({
          data: po.workers.map((w) => ({ id: randomUUID(), companyId, productionOrderId: po.id, employeeId: w.employeeId, percent: w.percent })),
        });
      }
    }
    counts.productionOrders = graph.productionOrders.filter((po) => po.assemblyId).length;

    // --- Step 8b: QcChecks + QcCheckResult ---
    for (const qc of graph.qcChecks) {
      const existing = await tx.qcCheck.findFirst({ where: { companyId, finishedGoodId: qc.finishedGoodId, checkedAt: qc.checkedAt } });
      const checkId = existing?.id ?? qc.id;
      if (!existing) {
        await tx.qcCheck.create({ data: { id: qc.id, companyId, finishedGoodId: qc.finishedGoodId, result: qc.result, inspectorId: graph.owner.id, comment: qc.comment, checkedAt: qc.checkedAt } });
        if (qc.results.length > 0) {
          await tx.qcCheckResult.createMany({ data: qc.results.map((r) => ({ id: randomUUID(), companyId, qcCheckId: checkId, itemName: r.itemName, passed: r.passed })) });
        }
      }
    }
    counts.qcChecks = graph.qcChecks.length;

    // --- Step 8c: CustomerOrders + Items ---
    for (const co of graph.customerOrders) {
      await tx.customerOrder.upsert({
        where: { companyId_legacyId: { companyId, legacyId: co.legacyId } },
        create: { id: co.id, companyId, legacyId: co.legacyId, orderNumber: co.orderNumber, clientName: co.clientName, contactPerson: co.contactPerson, deadline: co.deadline, priority: co.priority as never, status: co.status as never, comment: co.comment, createdById: graph.owner.id, createdAt: co.createdAt },
        update: { status: co.status as never, comment: co.comment },
      });
    }
    counts.customerOrders = graph.customerOrders.length;

    for (const item of graph.customerOrderItems) {
      const existing = await tx.customerOrderItem.findFirst({ where: { companyId, customerOrderId: item.customerOrderId, assemblyId: item.assemblyId, qty: item.qty } });
      if (!existing) {
        await tx.customerOrderItem.create({ data: { id: item.id, companyId, customerOrderId: item.customerOrderId, assemblyId: item.assemblyId, qty: item.qty, productionOrderId: item.productionOrderId } });
      }
    }
    counts.customerOrderItems = graph.customerOrderItems.length;

    // --- Step 8d: Shipments + Items ---
    for (const s of graph.shipments) {
      await tx.shipment.upsert({
        where: { companyId_legacyId: { companyId, legacyId: s.legacyId } },
        create: { id: s.id, companyId, legacyId: s.legacyId, carrier: s.carrier, waybillNumber: s.waybillNumber, packageCount: s.packageCount, weightKg: s.weightKg, dimensions: s.dimensions, status: s.status as never, customerOrderId: s.customerOrderId, comment: s.comment, createdById: graph.owner.id, shipDate: s.shipDate, deliveryDate: s.deliveryDate, createdAt: s.createdAt },
        update: { status: s.status as never, deliveryDate: s.deliveryDate },
      });
    }
    counts.shipments = graph.shipments.length;

    for (const item of graph.shipmentItems) {
      const existing = await tx.shipmentItem.findFirst({ where: { companyId, shipmentId: item.shipmentId, finishedGoodId: item.finishedGoodId } });
      if (!existing) await tx.shipmentItem.create({ data: { id: item.id, companyId, shipmentId: item.shipmentId, finishedGoodId: item.finishedGoodId } });
    }
    counts.shipmentItems = graph.shipmentItems.length;

    // --- Step 8e: PurchaseOrders + Items ---
    for (const po of graph.purchaseOrders) {
      await tx.purchaseOrder.upsert({
        where: { companyId_legacyId: { companyId, legacyId: po.legacyId } },
        create: { id: po.id, companyId, legacyId: po.legacyId, supplierId: po.supplierId, supplierNameSnapshot: po.supplierNameSnapshot, status: po.status as never, orderDate: po.orderDate, expectedDeliveryDate: po.expectedDeliveryDate, comment: po.comment, sourceCustomerOrderId: po.sourceCustomerOrderId, createdById: graph.owner.id, createdAt: po.createdAt },
        update: { status: po.status as never, expectedDeliveryDate: po.expectedDeliveryDate },
      });
    }
    counts.purchaseOrders = graph.purchaseOrders.length;

    for (const item of graph.purchaseOrderItems) {
      const existing = await tx.purchaseOrderItem.findFirst({ where: { companyId, purchaseOrderId: item.purchaseOrderId, articleSnapshot: item.articleSnapshot } });
      if (!existing) {
        await tx.purchaseOrderItem.create({ data: { id: item.id, companyId, purchaseOrderId: item.purchaseOrderId, productId: item.productId, articleSnapshot: item.articleSnapshot, productNameSnapshot: item.productNameSnapshot, qtyOrdered: item.qtyOrdered, qtyReceived: item.qtyReceived, expectedPrice: item.expectedPrice, actualPrice: item.actualPrice } });
      } else {
        await tx.purchaseOrderItem.update({ where: { id: existing.id }, data: { qtyReceived: item.qtyReceived, actualPrice: item.actualPrice } });
      }
    }
    counts.purchaseOrderItems = graph.purchaseOrderItems.length;

    // --- Step 8f: InventorySessions + Items ---
    for (const s of graph.inventorySessions) {
      await tx.inventorySession.upsert({
        where: { companyId_legacyId: { companyId, legacyId: s.legacyId } },
        create: { id: s.id, companyId, legacyId: s.legacyId, name: s.name, status: s.status as never, startedById: graph.owner.id, comment: s.comment, startedAt: s.startedAt, completedAt: s.completedAt },
        update: { status: s.status as never, completedAt: s.completedAt },
      });
    }
    counts.inventorySessions = graph.inventorySessions.length;

    for (const item of graph.inventoryItems) {
      if (!item.productId) continue; // required FK — already warned during transform
      const existing = await tx.inventoryItem.findFirst({ where: { companyId, inventorySessionId: item.inventorySessionId, productId: item.productId } });
      if (!existing) {
        await tx.inventoryItem.create({ data: { id: item.id, companyId, inventorySessionId: item.inventorySessionId, productId: item.productId, expectedQty: item.expectedQty, actualQty: item.actualQty, counted: item.counted } });
      }
    }
    counts.inventoryItems = graph.inventoryItems.filter((i) => i.productId).length;

    // --- Step 8g: PayrollEntries (immutable ledger — legacyId unique, upsert is really just "insert once") ---
    for (const p of graph.payrollEntries) {
      await tx.payrollEntry.upsert({
        where: { companyId_legacyId: { companyId, legacyId: p.legacyId } },
        create: { id: p.id, companyId, legacyId: p.legacyId, employeeId: p.employeeId, type: p.type as never, productionOrderId: p.productionOrderId, unitsProduced: p.unitsProduced, amount: p.amount, entryDate: p.entryDate, comment: p.comment, createdById: graph.owner.id, createdAt: p.createdAt },
        update: {},
      });
    }
    counts.payrollEntries = graph.payrollEntries.length;

    // --- Step 9: StockMovement + AuditEvent (both immutable/append-only — no upsert key at all, so these are ONLY inserted when the company has zero existing rows of that type, mirroring the ProductionStage/QcChecklistItem fallback above, for the same reason: no natural per-row idempotency key exists for a plain historical log entry). ---
    const existingMovementCount = await tx.stockMovement.count({ where: { companyId } });
    if (existingMovementCount === 0 && graph.stockMovements.length > 0) {
      await tx.stockMovement.createMany({
        data: graph.stockMovements.map((m) => ({ id: m.id, companyId, productId: m.productId, type: m.type as never, qtyDelta: m.qtyDelta, qtyAfter: m.qtyAfter, comment: m.comment, createdAt: m.createdAt })),
      });
    }
    counts.stockMovements = existingMovementCount === 0 ? graph.stockMovements.length : 0;

    const existingAuditCount = await tx.auditEvent.count({ where: { companyId } });
    if (existingAuditCount === 0 && graph.auditEvents.length > 0) {
      await tx.auditEvent.createMany({
        data: graph.auditEvents.map((a) => ({ id: a.id, companyId, action: a.action, entityType: a.entityType, entityId: a.entityId ?? companyId, metadata: a.metadata as never, createdAt: a.createdAt })),
      });
    }
    counts.auditEvents = existingAuditCount === 0 ? graph.auditEvents.length : 0;

    return counts;
  }, { timeout: 10 * 60 * 1000 }); // a real company migration can be large — 10 minutes, not Prisma's 5s default

  return { counts: result };
}

/** Shared create/update field object for Product (upsert's create and update payloads only differ by id/companyId/legacyId, which the caller adds). */
function productCreateFields(p: TransformedCompanyGraph['products'][number]) {
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
