import { Injectable } from '@nestjs/common';
import { CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AssembliesService } from '../bom/assemblies.service';
import { AuditService } from '../audit/audit.service';
import { TransportUnitTypesService } from '../logistics/transport-unit-types.service';
import { PackBox, TruckDims, layoutSingleTruck, packBoxesIntoTrucks } from './load-plan-packing';

export interface LoadPlanTruckView {
  id: string;
  index: number;
  items: { id: string; customerOrderItemId: string; assemblyId: string; assemblyName: string; unitsQty: number; weightKg: number }[];
  placedBoxes: { assemblyId: string; x: number; y: number; z: number; lengthCm: number; widthCm: number; heightCm: number }[];
  overflowBoxCount: number;
  totalWeightKg: number;
  volumeUsedPercent: number;
}

export interface LoadPlanView {
  id: string;
  transportUnitTypeId: string;
  transportUnitTypeName: string;
  trucks: LoadPlanTruckView[];
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

    const missingPackaging: string[] = [];
    const packBoxes: PackBox[] = [];
    for (const item of items as any[]) {
      const assembly = item.assembly;
      if (assembly.boxLengthCm == null || assembly.boxWidthCm == null || assembly.boxHeightCm == null) {
        missingPackaging.push(assembly.name);
        continue;
      }
      const weight = await this.assembliesService.calculateWeight(user, item.assemblyId);
      const totalUnits = Math.ceil(Number(item.qty));
      const unitsPerBox: number = assembly.unitsPerBox ?? 1;
      const boxesCount = Math.ceil(totalUnits / unitsPerBox);
      let unitsLeft = totalUnits;
      for (let i = 0; i < boxesCount; i++) {
        const unitsInThisBox = Math.min(unitsPerBox, unitsLeft);
        unitsLeft -= unitsInThisBox;
        packBoxes.push({
          customerOrderItemId: item.id,
          assemblyId: item.assemblyId,
          lengthCm: Number(assembly.boxLengthCm),
          widthCm: Number(assembly.boxWidthCm),
          heightCm: Number(assembly.boxHeightCm),
          weightKg: weight.weightPerUnitKg * unitsInThisBox,
          unitsQty: unitsInThisBox,
        });
      }
    }
    if (missingPackaging.length > 0) {
      throw new CodedConflictException(
        'LOAD_PLAN_PACKAGING_INCOMPLETE',
        `Add box dimensions before generating a load plan for: ${missingPackaging.join(', ')}.`,
      );
    }

    const truckDims: TruckDims = {
      lengthCm: Number(transportType.lengthCm),
      widthCm: Number(transportType.widthCm),
      heightCm: Number(transportType.heightCm),
      maxWeightKg: Number(transportType.maxWeightKg),
    };
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

    const plan = await this.prisma.tenant.$transaction(async (tx) => {
      await tx.loadPlan.deleteMany({ where: { customerOrderId } }); // cascades to trucks/items
      const newPlan = await tx.loadPlan.create({
        data: { customerOrderId, transportUnitTypeId, createdById: user.userId } as any,
      });
      for (const index of truckIndices) {
        const truck = await tx.loadPlanTruck.create({ data: { loadPlanId: newPlan.id, index } as any });
        const rows = [...byTruckAndItem.values()].filter((r) => r.truckIndex === index);
        await tx.loadPlanItem.createMany({
          data: rows.map((r) => ({
            loadPlanTruckId: truck.id,
            customerOrderItemId: r.customerOrderItemId,
            assemblyId: r.assemblyId,
            unitsQty: r.unitsQty,
          })) as any,
        });
      }
      return newPlan;
    });

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

    const assemblyIds = [...new Set((plan.trucks as any[]).flatMap((t) => t.items.map((i: any) => i.assemblyId)))];
    const assemblies = await this.prisma.tenant.assembly.findMany({ where: { id: { in: assemblyIds } } });
    const assemblyById = new Map((assemblies as any[]).map((a) => [a.id, a]));
    const weightByAssembly = new Map<string, number>();
    for (const id of assemblyIds) {
      weightByAssembly.set(id, (await this.assembliesService.calculateWeight(user, id)).weightPerUnitKg);
    }

    const trucks: LoadPlanTruckView[] = [];
    for (const truck of plan.trucks as any[]) {
      const packBoxes: PackBox[] = [];
      for (const item of truck.items as any[]) {
        const assembly = assemblyById.get(item.assemblyId);
        if (!assembly || assembly.boxLengthCm == null) continue; // packaging may have been cleared since the plan was generated
        const unitsPerBox: number = assembly.unitsPerBox ?? 1;
        let unitsLeft = item.unitsQty;
        while (unitsLeft > 0) {
          const unitsInThisBox = Math.min(unitsPerBox, unitsLeft);
          unitsLeft -= unitsInThisBox;
          packBoxes.push({
            customerOrderItemId: item.customerOrderItemId,
            assemblyId: item.assemblyId,
            lengthCm: Number(assembly.boxLengthCm),
            widthCm: Number(assembly.boxWidthCm),
            heightCm: Number(assembly.boxHeightCm),
            weightKg: (weightByAssembly.get(item.assemblyId) ?? 0) * unitsInThisBox,
            unitsQty: unitsInThisBox,
          });
        }
      }

      const { placed, overflow } = layoutSingleTruck(packBoxes, truckDims);
      const totalWeightKg = placed.reduce((sum, b) => sum + b.weightKg, 0);
      const usedVolumeCm3 = placed.reduce((sum, b) => sum + b.lengthCm * b.widthCm * b.heightCm, 0);

      trucks.push({
        id: truck.id,
        index: truck.index,
        items: (truck.items as any[]).map((item) => ({
          id: item.id,
          customerOrderItemId: item.customerOrderItemId,
          assemblyId: item.assemblyId,
          assemblyName: assemblyById.get(item.assemblyId)?.name ?? item.assemblyId,
          unitsQty: item.unitsQty,
          weightKg: (weightByAssembly.get(item.assemblyId) ?? 0) * item.unitsQty,
        })),
        placedBoxes: placed.map((b) => ({ assemblyId: b.assemblyId, x: b.x, y: b.y, z: b.z, lengthCm: b.lengthCm, widthCm: b.widthCm, heightCm: b.heightCm })),
        overflowBoxCount: overflow.length,
        totalWeightKg,
        volumeUsedPercent: truckVolumeCm3 > 0 ? (usedVolumeCm3 / truckVolumeCm3) * 100 : 0,
      });
    }

    return {
      id: plan.id,
      transportUnitTypeId: plan.transportUnitTypeId,
      transportUnitTypeName: transportType.name,
      trucks,
    };
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
}
