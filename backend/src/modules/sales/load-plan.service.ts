import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AssembliesService } from '../bom/assemblies.service';
import { AuditService } from '../audit/audit.service';
import { TransportUnitTypesService } from '../logistics/transport-unit-types.service';
import { AddLoadPlanItemDto, SetLoadPlanBoxPositionDto } from './dto/load-plan.dto';
import { PackBox, PlacedBox, StrapPlan, TruckDims, computeStrapPlan, layoutSingleTruck, packBoxesIntoTrucks } from './load-plan-packing';

export interface LoadPlanTruckView {
  id: string;
  index: number;
  items: {
    id: string;
    customerOrderItemId: string | null;
    assemblyId: string | null;
    assemblyName: string;
    /** `ORDER` = normal line derived from the customer order. `ASSEMBLY`/`MANUAL` = added directly to the plan — see LoadPlanService#addItem. */
    source: 'ORDER' | 'ASSEMBLY' | 'MANUAL';
    unitsQty: number;
    weightKg: number;
  }[];
  placedBoxes: {
    assemblyId: string;
    x: number;
    y: number;
    z: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    /** Which LoadPlanItem/box this is — target for PUT/DELETE .../boxes/:boxIndex/position. */
    loadPlanItemId: string;
    boxIndex: number;
    /** `true` when a LoadPlanBoxPosition override placed this box here instead of the auto-packer. */
    isManuallyPlaced: boolean;
  }[];
  overflowBoxCount: number;
  totalWeightKg: number;
  volumeUsedPercent: number;
  /** How to tie this truck's load down — null only when the truck has nothing placed in it. */
  strapPlan: StrapPlan | null;
}

export interface LoadPlanSkippedAssembly {
  id: string;
  name: string;
  /** `missing-packaging` — no box dimensions set at all. `does-not-fit` — box dimensions (or a single box's weight) exceed the chosen transport type's own envelope/weight limit, so it could never fit this truck type regardless of how the rest of the order packs. */
  reason: 'missing-packaging' | 'does-not-fit';
}

export interface LoadPlanView {
  id: string;
  transportUnitTypeId: string;
  transportUnitTypeName: string;
  trucks: LoadPlanTruckView[];
  /**
   * Order lines left out of `trucks` entirely — the plan covers everything
   * it CAN, rather than refusing to generate at all over a few lines that
   * can't be packed. Recomputed fresh on every `get()` from the order's
   * CURRENT items/assemblies and the plan's own transport type (not frozen
   * at generate() time), so fixing an assembly's packaging — or switching
   * to a bigger transport type — makes a line disappear from this list
   * without needing to regenerate by hand.
   */
  skippedAssemblies: LoadPlanSkippedAssembly[];
}

/**
 * Load-plan module (2026-10-28) — a forward-looking, purely PLANNING tool:
 * packs the FULL ordered quantity (CustomerOrderItem.qty), not what's
 * actually been produced/shipped so far, so a manager can see "how many
 * trucks will this whole order need" before production even starts. Never
 * auto-materializes into a real Shipment. 3D box positions are never
 * stored — only "which truck is this order-line's qty assigned to"
 * persists (LoadPlanItem.loadPlanTruckId); get() recomputes the actual
 * layout live via load-plan-packing.ts every time, same "compute, don't
 * store" convention as AssembliesService#calculateWeight.
 */
@Injectable()
export class LoadPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly assembliesService: AssembliesService,
    private readonly transportUnitTypesService: TransportUnitTypesService,
  ) {}

  async generate(user: RequestUser, customerOrderId: string, transportUnitTypeId: string) {
    const order = await this.prisma.tenant.customerOrder.findUnique({ where: { id: customerOrderId } });
    if (!order) throw new CodedNotFoundException('CUSTOMER_ORDER_NOT_FOUND', 'Customer order not found.');

    const transportType = await this.transportUnitTypesService.findOne(user, transportUnitTypeId);
    if (transportType.lengthCm == null || transportType.widthCm == null || transportType.heightCm == null) {
      throw new CodedConflictException(
        'LOAD_PLAN_TRANSPORT_TYPE_NO_DIMENSIONS',
        'This transport type has no interior dimensions set — add length/width/height before generating a load plan.',
      );
    }

    const items = await this.prisma.tenant.customerOrderItem.findMany({
      where: { customerOrderId },
      include: { assembly: true },
    });
    if (items.length === 0) {
      throw new CodedConflictException('LOAD_PLAN_NO_ITEMS', 'This order has no line items to plan.');
    }

    const truckDims: TruckDims = {
      lengthCm: Number(transportType.lengthCm),
      widthCm: Number(transportType.widthCm),
      heightCm: Number(transportType.heightCm),
      maxWeightKg: Number(transportType.maxWeightKg),
    };

    // Lines that can't be packed — no box dimensions at all, OR a box that
    // (even on its own) is bigger than the truck's own empty envelope, OR
    // a single box heavier than the truck's own max weight — are left OUT
    // of the pack rather than blocking the whole plan: "ген план все
    // одно, але без урахування того що нема, і пиши що план згенеровано
    // без урахування цих позицій" (2026-10-28). Pre-filtering here means
    // `packBoxesIntoTrucks` below only ever sees boxes that are guaranteed
    // to fit SOME truck — its own per-box envelope/weight checks become a
    // defensive invariant that should never actually trigger from this
    // caller. `get()`'s `findSkippedAssemblies` redoes this exact same
    // classification live, so this loop doesn't need to collect/return it.
    const packBoxes: PackBox[] = [];
    for (const item of items as any[]) {
      const assembly = item.assembly;
      if (assembly.boxLengthCm == null || assembly.boxWidthCm == null || assembly.boxHeightCm == null) {
        continue;
      }
      const lengthCm = Number(assembly.boxLengthCm);
      const widthCm = Number(assembly.boxWidthCm);
      const heightCm = Number(assembly.boxHeightCm);
      if (lengthCm > truckDims.lengthCm || widthCm > truckDims.widthCm || heightCm > truckDims.heightCm) {
        continue;
      }
      const weight = await this.assembliesService.calculateWeight(user, item.assemblyId);
      const totalUnits = Math.ceil(Number(item.qty));
      const unitsPerBox: number = assembly.unitsPerBox ?? 1;
      if (weight.weightPerUnitKg * Math.min(unitsPerBox, totalUnits) > truckDims.maxWeightKg) {
        continue;
      }
      const boxesCount = Math.ceil(totalUnits / unitsPerBox);
      let unitsLeft = totalUnits;
      for (let i = 0; i < boxesCount; i++) {
        const unitsInThisBox = Math.min(unitsPerBox, unitsLeft);
        unitsLeft -= unitsInThisBox;
        packBoxes.push({
          customerOrderItemId: item.id,
          assemblyId: item.assemblyId,
          lengthCm,
          widthCm,
          heightCm,
          weightKg: weight.weightPerUnitKg * unitsInThisBox,
          unitsQty: unitsInThisBox,
          stackable: assembly.boxStackable ?? true,
          maxStackWeightKg: assembly.boxMaxStackWeightKg == null ? null : Number(assembly.boxMaxStackWeightKg),
          // No real LoadPlanItem row exists yet at this point (this pass
          // only aggregates qty-per-truck to CREATE those rows below) —
          // these two fields are never read from THIS placement result,
          // only from get()'s own (separate) packing pass afterward.
          loadPlanItemId: item.id,
          boxIndex: i,
        });
      }
    }
    const placed = packBoxesIntoTrucks(packBoxes, truckDims);

    // Collapse placed boxes back into (truckIndex, customerOrderItemId) rows.
    const byTruckAndItem = new Map<string, { truckIndex: number; customerOrderItemId: string; assemblyId: string; unitsQty: number }>();
    for (const box of placed) {
      const key = `${box.truckIndex}:${box.customerOrderItemId}`;
      const existing = byTruckAndItem.get(key);
      if (existing) existing.unitsQty += box.unitsQty;
      else byTruckAndItem.set(key, { truckIndex: box.truckIndex, customerOrderItemId: box.customerOrderItemId, assemblyId: box.assemblyId, unitsQty: box.unitsQty });
    }
    const truckIndices = [...new Set([...byTruckAndItem.values()].map((r) => r.truckIndex))].sort((a, b) => a - b);

    // No explicit `$transaction` wrapper here, deliberately: `this.prisma.
    // tenant` inside a request handler is ALREADY the per-request
    // transaction client TenantScopeInterceptor opened (see PrismaService's
    // own header comment) — it has no `.$transaction` of its own (nested
    // transactions aren't a thing on Prisma's interactive-tx client), and
    // every call below is already atomic as part of that same request-wide
    // transaction without wrapping it again.
    await this.prisma.tenant.loadPlan.deleteMany({ where: { customerOrderId } }); // cascades to trucks/items
    const plan = await this.prisma.tenant.loadPlan.create({
      data: { customerOrderId, transportUnitTypeId, createdById: user.userId } as any,
    });
    for (const index of truckIndices) {
      const truck = await this.prisma.tenant.loadPlanTruck.create({ data: { loadPlanId: plan.id, index } as any });
      const rows = [...byTruckAndItem.values()].filter((r) => r.truckIndex === index);
      await this.prisma.tenant.loadPlanItem.createMany({
        data: rows.map((r) => ({
          loadPlanTruckId: truck.id,
          customerOrderItemId: r.customerOrderItemId,
          assemblyId: r.assemblyId,
          unitsQty: r.unitsQty,
        })) as any,
      });
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'load_plan.generated',
      entityType: 'LoadPlan',
      entityId: plan.id,
      after: { customerOrderId, transportUnitTypeId, truckCount: truckIndices.length },
    });

    return this.get(user, customerOrderId);
  }

  async get(user: RequestUser, customerOrderId: string): Promise<LoadPlanView | null> {
    const plan = await this.prisma.tenant.loadPlan.findUnique({
      where: { companyId_customerOrderId: { companyId: user.companyId, customerOrderId } },
      include: { transportUnitType: true, trucks: { include: { items: true }, orderBy: { index: 'asc' } } },
    });
    if (!plan) return null;

    const transportType = plan.transportUnitType as any;
    const truckDims: TruckDims = {
      lengthCm: Number(transportType.lengthCm),
      widthCm: Number(transportType.widthCm),
      heightCm: Number(transportType.heightCm),
      maxWeightKg: Number(transportType.maxWeightKg),
    };
    const truckVolumeCm3 = truckDims.lengthCm * truckDims.widthCm * truckDims.heightCm;

    const assemblyIds = [...new Set((plan.trucks as any[]).flatMap((t) => t.items.map((i: any) => i.assemblyId)).filter((id: string | null): id is string => id != null))];
    const assemblies = await this.prisma.tenant.assembly.findMany({ where: { id: { in: assemblyIds } } });
    const assemblyById = new Map((assemblies as any[]).map((a) => [a.id, a]));
    const weightByAssembly = new Map<string, number>();
    for (const id of assemblyIds) {
      weightByAssembly.set(id, (await this.assembliesService.calculateWeight(user, id)).weightPerUnitKg);
    }

    // Manual drag positioning (2026-10-30) — every override for every item
    // across every truck of this plan, fetched once up front rather than
    // per-truck. `boxIndex` is the same deterministic loop index assigned
    // below as each item's boxes are enumerated (0, 1, 2, ... in the exact
    // order already used for both branches) — stable release-over-release
    // as long as the item's own unitsQty/packaging doesn't change.
    const allItemIds = (plan.trucks as any[]).flatMap((t) => t.items.map((i: any) => i.id));
    const boxPositions = allItemIds.length > 0 ? await this.prisma.tenant.loadPlanBoxPosition.findMany({ where: { loadPlanItemId: { in: allItemIds } } }) : [];
    const overridesByItem = new Map<string, Map<number, { xCm: number; yCm: number; zCm: number }>>();
    for (const pos of boxPositions as any[]) {
      let byIndex = overridesByItem.get(pos.loadPlanItemId);
      if (!byIndex) {
        byIndex = new Map();
        overridesByItem.set(pos.loadPlanItemId, byIndex);
      }
      byIndex.set(pos.boxIndex, { xCm: Number(pos.xCm), yCm: Number(pos.yCm), zCm: Number(pos.zCm) });
    }

    const trucks: LoadPlanTruckView[] = [];
    for (const truck of plan.trucks as any[]) {
      const packBoxes: PackBox[] = [];
      // Boxes with a stored override skip the auto-packer entirely — built
      // directly as PlacedBox-shaped entries at their pinned position, then
      // merged back in below. The auto-packer never sees them, so it packs
      // everything else blind to where they ended up (no collision check
      // against a manually-placed box — see the schema's own header
      // comment on LoadPlanBoxPosition for why that's a deliberate
      // tradeoff, not an oversight).
      const manualPlacements: PlacedBox[] = [];

      function pushBox(box: Omit<PackBox, 'loadPlanItemId' | 'boxIndex'>, itemId: string, boxIndex: number) {
        const override = overridesByItem.get(itemId)?.get(boxIndex);
        if (override) {
          manualPlacements.push({ ...box, loadPlanItemId: itemId, boxIndex, truckIndex: truck.index, x: override.xCm, y: override.yCm, z: override.zCm });
        } else {
          packBoxes.push({ ...box, loadPlanItemId: itemId, boxIndex });
        }
      }

      for (const item of truck.items as any[]) {
        // Ad-hoc, fully manual box (2026-10-30) — no Assembly at all, every
        // dimension/weight comes straight off the item's own manual*
        // columns. `assemblyId`/`customerOrderItemId` on PackBox are only
        // ever read as opaque grouping/identity keys elsewhere (never
        // surfaced in the API response, never resolved against a real
        // Assembly past this point) — the item's own id stands in for
        // both, so each manual line still gets its own row-grouping and a
        // stable color on the frontend (colorForAssembly), same as a real
        // assembly would.
        if (item.assemblyId == null) {
          if (item.manualLengthCm == null || item.manualWidthCm == null || item.manualHeightCm == null) continue; // defensive — addItem() already requires these together
          for (let i = 0; i < item.unitsQty; i++) {
            pushBox(
              {
                customerOrderItemId: item.id,
                assemblyId: item.id,
                lengthCm: Number(item.manualLengthCm),
                widthCm: Number(item.manualWidthCm),
                heightCm: Number(item.manualHeightCm),
                weightKg: item.manualWeightKg == null ? 0 : Number(item.manualWeightKg),
                unitsQty: 1,
                stackable: true,
                maxStackWeightKg: null,
              },
              item.id,
              i,
            );
          }
          continue;
        }

        const assembly = assemblyById.get(item.assemblyId);
        if (!assembly || assembly.boxLengthCm == null) continue; // packaging may have been cleared since the plan was generated
        const unitsPerBox: number = assembly.unitsPerBox ?? 1;
        let unitsLeft = item.unitsQty;
        let boxIndex = 0;
        while (unitsLeft > 0) {
          const unitsInThisBox = Math.min(unitsPerBox, unitsLeft);
          unitsLeft -= unitsInThisBox;
          pushBox(
            {
              // Ad-hoc catalog pick (customerOrderItemId null, assemblyId
              // set) has no real CustomerOrderItem to key off — the item's
              // own id stands in, same reasoning as the manual case above.
              customerOrderItemId: item.customerOrderItemId ?? item.id,
              assemblyId: item.assemblyId,
              lengthCm: Number(assembly.boxLengthCm),
              widthCm: Number(assembly.boxWidthCm),
              heightCm: Number(assembly.boxHeightCm),
              weightKg: (weightByAssembly.get(item.assemblyId) ?? 0) * unitsInThisBox,
              unitsQty: unitsInThisBox,
              stackable: assembly.boxStackable ?? true,
              maxStackWeightKg: assembly.boxMaxStackWeightKg == null ? null : Number(assembly.boxMaxStackWeightKg),
            },
            item.id,
            boxIndex,
          );
          boxIndex += 1;
        }
      }

      const { placed: autoPlaced, overflow } = layoutSingleTruck(packBoxes, truckDims);
      const placed = [...manualPlacements, ...autoPlaced];
      const manuallyPlacedKeys = new Set(manualPlacements.map((b) => `${b.loadPlanItemId}:${b.boxIndex}`));
      const totalWeightKg = placed.reduce((sum, b) => sum + b.weightKg, 0);
      const usedVolumeCm3 = placed.reduce((sum, b) => sum + b.lengthCm * b.widthCm * b.heightCm, 0);

      trucks.push({
        id: truck.id,
        index: truck.index,
        items: (truck.items as any[]).map((item) => {
          const source: 'ORDER' | 'ASSEMBLY' | 'MANUAL' = item.customerOrderItemId != null ? 'ORDER' : item.assemblyId != null ? 'ASSEMBLY' : 'MANUAL';
          const name = assemblyById.get(item.assemblyId)?.name ?? item.manualName ?? item.id;
          const weightKg = item.assemblyId == null ? (item.manualWeightKg == null ? 0 : Number(item.manualWeightKg)) * item.unitsQty : (weightByAssembly.get(item.assemblyId) ?? 0) * item.unitsQty;
          return {
            id: item.id,
            customerOrderItemId: item.customerOrderItemId,
            assemblyId: item.assemblyId,
            assemblyName: name,
            source,
            unitsQty: item.unitsQty,
            weightKg,
          };
        }),
        placedBoxes: placed.map((b) => ({
          assemblyId: b.assemblyId,
          x: b.x,
          y: b.y,
          z: b.z,
          lengthCm: b.lengthCm,
          widthCm: b.widthCm,
          heightCm: b.heightCm,
          loadPlanItemId: b.loadPlanItemId,
          boxIndex: b.boxIndex,
          isManuallyPlaced: manuallyPlacedKeys.has(`${b.loadPlanItemId}:${b.boxIndex}`),
        })),
        overflowBoxCount: overflow.length,
        totalWeightKg,
        volumeUsedPercent: truckVolumeCm3 > 0 ? (usedVolumeCm3 / truckVolumeCm3) * 100 : 0,
        strapPlan: computeStrapPlan(placed, truckDims),
      });
    }

    const skippedAssemblies = await this.findSkippedAssemblies(user, customerOrderId, truckDims);

    return {
      id: plan.id,
      transportUnitTypeId: plan.transportUnitTypeId,
      transportUnitTypeName: transportType.name,
      trucks,
      skippedAssemblies,
    };
  }

  /** Order lines that can't be packed into this plan's truck type — same three-way check `generate()`'s box-building loop uses to decide what to leave out, re-run live against the order's CURRENT items/assemblies and the plan's CURRENT transport type (not frozen at generate() time). */
  private async findSkippedAssemblies(user: RequestUser, customerOrderId: string, truckDims: TruckDims): Promise<LoadPlanSkippedAssembly[]> {
    const items = await this.prisma.tenant.customerOrderItem.findMany({
      where: { customerOrderId },
      include: { assembly: true },
    });
    const seen = new Set<string>();
    const skipped: LoadPlanSkippedAssembly[] = [];
    for (const item of items as any[]) {
      const assembly = item.assembly;
      if (seen.has(assembly.id)) continue;

      if (assembly.boxLengthCm == null || assembly.boxWidthCm == null || assembly.boxHeightCm == null) {
        seen.add(assembly.id);
        skipped.push({ id: assembly.id, name: assembly.name, reason: 'missing-packaging' });
        continue;
      }

      const lengthCm = Number(assembly.boxLengthCm);
      const widthCm = Number(assembly.boxWidthCm);
      const heightCm = Number(assembly.boxHeightCm);
      if (lengthCm > truckDims.lengthCm || widthCm > truckDims.widthCm || heightCm > truckDims.heightCm) {
        seen.add(assembly.id);
        skipped.push({ id: assembly.id, name: assembly.name, reason: 'does-not-fit' });
        continue;
      }

      const unitsPerBox: number = assembly.unitsPerBox ?? 1;
      const totalUnits = Math.ceil(Number(item.qty));
      const weight = await this.assembliesService.calculateWeight(user, item.assemblyId);
      if (weight.weightPerUnitKg * Math.min(unitsPerBox, totalUnits) > truckDims.maxWeightKg) {
        seen.add(assembly.id);
        skipped.push({ id: assembly.id, name: assembly.name, reason: 'does-not-fit' });
      }
    }
    return skipped;
  }

  async moveItem(user: RequestUser, customerOrderId: string, itemId: string, toTruckIndex: number) {
    const plan = await this.prisma.tenant.loadPlan.findUnique({ where: { companyId_customerOrderId: { companyId: user.companyId, customerOrderId } } });
    if (!plan) throw new CodedNotFoundException('LOAD_PLAN_NOT_FOUND', 'No load plan exists for this order yet — generate one first.');

    const item = await this.prisma.tenant.loadPlanItem.findUnique({ where: { id: itemId } });
    if (!item) throw new CodedNotFoundException('LOAD_PLAN_ITEM_NOT_FOUND', 'Load plan item not found.');

    let targetTruck = await this.prisma.tenant.loadPlanTruck.findFirst({ where: { loadPlanId: plan.id, index: toTruckIndex } });
    if (!targetTruck) {
      targetTruck = await this.prisma.tenant.loadPlanTruck.create({ data: { loadPlanId: plan.id, index: toTruckIndex } as any });
    }

    await this.prisma.tenant.loadPlanItem.update({ where: { id: itemId }, data: { loadPlanTruckId: targetTruck.id } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'load_plan.item_moved',
      entityType: 'LoadPlanItem',
      entityId: itemId,
      after: { toTruckIndex },
    });

    return this.get(user, customerOrderId);
  }

  /**
   * Ad-hoc item (2026-10-30, "також додавати той якого нема в замовленні")
   * — adds a line to an already-generated plan that isn't derived from the
   * order: either a real Assembly pick (`dto.assemblyId` set, same
   * packaging/weight lookup an order line already uses) or a fully manual
   * box (`dto.assemblyId` unset, described by `dto.manual*`). Wiped on the
   * next `generate()` same as every other LoadPlanItem — regenerating is a
   * fresh start, not a merge.
   */
  async addItem(user: RequestUser, customerOrderId: string, dto: AddLoadPlanItemDto) {
    const plan = await this.prisma.tenant.loadPlan.findUnique({ where: { companyId_customerOrderId: { companyId: user.companyId, customerOrderId } } });
    if (!plan) throw new CodedNotFoundException('LOAD_PLAN_NOT_FOUND', 'No load plan exists for this order yet — generate one first.');

    const isManual = !dto.assemblyId;
    if (isManual) {
      if (dto.manualName == null || dto.manualLengthCm == null || dto.manualWidthCm == null || dto.manualHeightCm == null || dto.manualWeightKg == null) {
        throw new CodedBadRequestException(
          'LOAD_PLAN_MANUAL_ITEM_INCOMPLETE',
          'A box with no catalog link needs a name, all three dimensions, and a weight.',
        );
      }
    } else {
      await this.assembliesService.findOne(user, dto.assemblyId!); // throws if it doesn't exist / isn't this company's
    }

    let targetTruck = await this.prisma.tenant.loadPlanTruck.findFirst({ where: { loadPlanId: plan.id, index: dto.truckIndex } });
    if (!targetTruck) {
      targetTruck = await this.prisma.tenant.loadPlanTruck.create({ data: { loadPlanId: plan.id, index: dto.truckIndex } as any });
    }

    const item = await this.prisma.tenant.loadPlanItem.create({
      data: {
        loadPlanTruckId: targetTruck.id,
        assemblyId: isManual ? null : dto.assemblyId,
        unitsQty: dto.unitsQty,
        manualName: isManual ? dto.manualName : null,
        manualLengthCm: isManual ? dto.manualLengthCm : null,
        manualWidthCm: isManual ? dto.manualWidthCm : null,
        manualHeightCm: isManual ? dto.manualHeightCm : null,
        manualWeightKg: isManual ? dto.manualWeightKg : null,
      } as any,
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'load_plan.item_added',
      entityType: 'LoadPlanItem',
      entityId: item.id,
      after: dto,
    });

    return this.get(user, customerOrderId);
  }

  /** Only ad-hoc items (added via `addItem`, no `customerOrderItemId`) can be removed here — an order-derived line disappears on its own if the order itself changes. */
  async removeItem(user: RequestUser, customerOrderId: string, itemId: string) {
    const plan = await this.prisma.tenant.loadPlan.findUnique({ where: { companyId_customerOrderId: { companyId: user.companyId, customerOrderId } } });
    if (!plan) throw new CodedNotFoundException('LOAD_PLAN_NOT_FOUND', 'No load plan exists for this order yet — generate one first.');

    const item = await this.prisma.tenant.loadPlanItem.findUnique({ where: { id: itemId } });
    if (!item) throw new CodedNotFoundException('LOAD_PLAN_ITEM_NOT_FOUND', 'Load plan item not found.');
    if ((item as any).customerOrderItemId != null) {
      throw new CodedBadRequestException('LOAD_PLAN_ITEM_NOT_REMOVABLE', 'Only ad-hoc items (not derived from the order) can be removed here.');
    }

    await this.prisma.tenant.loadPlanItem.delete({ where: { id: itemId } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'load_plan.item_removed',
      entityType: 'LoadPlanItem',
      entityId: itemId,
    });

    return this.get(user, customerOrderId);
  }

  /**
   * Manual drag positioning (2026-10-30, "можливість самому переміщувати
   * вантаж") — pins box `boxIndex` of `itemId` to an exact spot, pulling it
   * out of the auto-packer on every future `get()` until cleared. Only a
   * cheap bounds check against the truck's own envelope — no collision
   * check against other boxes, see the LoadPlanBoxPosition schema comment.
   */
  async setBoxPosition(user: RequestUser, customerOrderId: string, itemId: string, boxIndex: number, dto: SetLoadPlanBoxPositionDto) {
    if (!Number.isInteger(boxIndex) || boxIndex < 0) {
      throw new CodedBadRequestException('LOAD_PLAN_INVALID_BOX_INDEX', 'boxIndex must be a non-negative integer.');
    }
    const plan = await this.prisma.tenant.loadPlan.findUnique({
      where: { companyId_customerOrderId: { companyId: user.companyId, customerOrderId } },
      include: { transportUnitType: true },
    });
    if (!plan) throw new CodedNotFoundException('LOAD_PLAN_NOT_FOUND', 'No load plan exists for this order yet — generate one first.');

    const item = await this.prisma.tenant.loadPlanItem.findUnique({ where: { id: itemId }, include: { loadPlanTruck: true } });
    if (!item || (item as any).loadPlanTruck.loadPlanId !== plan.id) {
      throw new CodedNotFoundException('LOAD_PLAN_ITEM_NOT_FOUND', 'Load plan item not found.');
    }

    const transportType = plan.transportUnitType as any;
    const truckDims = { lengthCm: Number(transportType.lengthCm), widthCm: Number(transportType.widthCm), heightCm: Number(transportType.heightCm) };
    if (dto.xCm > truckDims.lengthCm || dto.yCm > truckDims.widthCm || dto.zCm > truckDims.heightCm) {
      throw new CodedBadRequestException(
        'LOAD_PLAN_BOX_POSITION_OUT_OF_BOUNDS',
        `Position is outside the truck's own envelope (${truckDims.lengthCm}×${truckDims.widthCm}×${truckDims.heightCm} cm).`,
      );
    }

    await this.prisma.tenant.loadPlanBoxPosition.upsert({
      where: { loadPlanItemId_boxIndex: { loadPlanItemId: itemId, boxIndex } },
      create: { loadPlanItemId: itemId, boxIndex, xCm: dto.xCm, yCm: dto.yCm, zCm: dto.zCm } as any,
      update: { xCm: dto.xCm, yCm: dto.yCm, zCm: dto.zCm },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'load_plan.box_position_set',
      entityType: 'LoadPlanItem',
      entityId: itemId,
      after: { boxIndex, ...dto },
    });

    return this.get(user, customerOrderId);
  }

  /** Clears a manual position override — the box rejoins auto-packing on the next `get()`. Idempotent: clearing a box that was never pinned is a no-op, not an error. */
  async clearBoxPosition(user: RequestUser, customerOrderId: string, itemId: string, boxIndex: number) {
    const plan = await this.prisma.tenant.loadPlan.findUnique({ where: { companyId_customerOrderId: { companyId: user.companyId, customerOrderId } } });
    if (!plan) throw new CodedNotFoundException('LOAD_PLAN_NOT_FOUND', 'No load plan exists for this order yet — generate one first.');

    await this.prisma.tenant.loadPlanBoxPosition.deleteMany({ where: { loadPlanItemId: itemId, boxIndex } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'load_plan.box_position_cleared',
      entityType: 'LoadPlanItem',
      entityId: itemId,
    });

    return this.get(user, customerOrderId);
  }
}
