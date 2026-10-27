import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AssembliesService } from '../bom/assemblies.service';
import { AuditService } from '../audit/audit.service';
import { TransportUnitTypesService } from '../logistics/transport-unit-types.service';
import { CreateShipmentDto, QueryShipmentsDto } from './dto/shipment.dto';

export interface ShipmentMetricsBreakdownLine {
  assemblyId: string;
  assemblyName: string;
  count: number;
  boxes: number;
  pallets: number | null;
  weightKg: number;
}

export interface TransportSuggestion {
  typeId: string;
  name: string;
  unitsNeeded: number;
}

/**
 * Result of calculateMetrics() — "place" = pallet when the assembly has
 * boxesPerPallet set, else the box itself, else (no packaging configured
 * at all) each FinishedGood unit — see calculateMetrics' own comment.
 * totalVolumeM3/volumeIncomplete mirror totalWeightKg/weightIncomplete:
 * a gap in ANY selected assembly's box dimensions makes the total `null`
 * (an understated sum would be worse than an honest "unknown").
 */
export interface ShipmentMetrics {
  totalWeightKg: number;
  weightIncomplete: boolean;
  totalPlaces: number;
  totalVolumeM3: number | null;
  volumeIncomplete: boolean;
  breakdown: ShipmentMetricsBreakdownLine[];
  transportSuggestions: TransportSuggestion[];
}

/**
 * Groups FinishedGoods units (by serial) into a shipment record and marks
 * each consumed unit's status `SHIPPED` (Shipments.gs, Phase 1 §3.4).
 *
 * Schema note: `Shipment` has no `deletedAt` — unlike most other entities
 * in this schema, there is no soft-delete column for it, even though the
 * legacy RBAC matrix lists shipment deletion as an admin-only capability.
 * Not treated as a frozen-architecture gap requiring sign-off (a real hard
 * delete for a not-yet-delivered logistics record is a reasonable, low-risk
 * reading of what's actually declared, and `ShipmentItem` cascades on
 * delete by design) — implemented as a genuine `delete()`, restricted to
 * shipments that haven't been marked DELIVERED yet, with the consumed
 * FinishedGoods reverted back to IN_STOCK so the delete is a real undo, not
 * a silent stock-accounting leak.
 */
@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly assembliesService: AssembliesService,
    private readonly transportUnitTypesService: TransportUnitTypesService,
  ) {}

  async create(user: RequestUser, dto: CreateShipmentDto) {
    const finishedGoods = await this.prisma.tenant.finishedGood.findMany({
      where: { id: { in: dto.finishedGoodIds } },
    });
    if (finishedGoods.length !== dto.finishedGoodIds.length) {
      throw new CodedNotFoundException('SHIPMENT_FINISHED_GOODS_NOT_FOUND', 'One or more finished goods were not found.');
    }
    const notInStock = finishedGoods.filter((g) => g.status !== 'IN_STOCK');
    if (notInStock.length > 0) {
      throw new CodedConflictException(
        'SHIPMENT_GOODS_NOT_IN_STOCK',
        `Cannot ship finished goods that are not IN_STOCK: ${notInStock.map((g) => g.serialNumber).join(', ')}.`,
      );
    }

    // Auto-fill weight/package-count from the same calculation the "new
    // shipment" UI previews live, whenever the caller didn't explicitly
    // supply them — keeps API clients that never call calculateMetrics
    // themselves from ending up with empty figures. An explicit DTO value
    // always wins (manual override, e.g. a corrected real scale weight).
    let packageCount = dto.packageCount;
    let weightKg = dto.weightKg;
    if (packageCount == null || weightKg == null) {
      const metrics = await this.calculateMetrics(user, dto.finishedGoodIds);
      if (packageCount == null) packageCount = metrics.totalPlaces;
      if (weightKg == null) weightKg = metrics.totalWeightKg;
    }

    const shipment = await this.prisma.tenant.shipment.create({
      data: {
        customerOrderId: dto.customerOrderId,
        carrier: dto.carrier,
        waybillNumber: dto.waybillNumber,
        packageCount,
        weightKg,
        dimensions: dto.dimensions,
        comment: dto.comment,
        status: 'SHIPPED',
        shipDate: new Date(),
        createdById: user.userId,
        items: {
          create: dto.finishedGoodIds.map((finishedGoodId) => ({ finishedGoodId })),
        },
      } as any,
      include: { items: true },
    });

    await this.prisma.tenant.finishedGood.updateMany({
      where: { id: { in: dto.finishedGoodIds } },
      data: { status: 'SHIPPED', ...(dto.customerOrderId ? { customerOrderId: dto.customerOrderId } : {}) },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'shipment.created',
      entityType: 'Shipment',
      entityId: shipment.id,
      after: shipment,
    });
    return shipment;
  }

  async findOne(user: RequestUser, id: string) {
    const shipment = await this.prisma.tenant.shipment.findUnique({ where: { id }, include: { items: true } });
    if (!shipment) throw new CodedNotFoundException('SHIPMENT_NOT_FOUND', 'Shipment not found.');
    return shipment;
  }

  async query(user: RequestUser, query: QueryShipmentsDto) {
    const where: Prisma.ShipmentWhereInput = {};
    if (query.status) where.status = query.status as any;
    if (query.customerOrderId) where.customerOrderId = query.customerOrderId;

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.shipment.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.tenant.shipment.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  async markDelivered(user: RequestUser, id: string) {
    const shipment = await this.findOne(user, id);
    if (shipment.status === 'DELIVERED') {
      throw new CodedBadRequestException('SHIPMENT_ALREADY_DELIVERED', 'This shipment is already marked delivered.');
    }
    const updated = await this.prisma.tenant.shipment.update({
      where: { id },
      data: { status: 'DELIVERED', deliveryDate: new Date() },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'shipment.delivered',
      entityType: 'Shipment',
      entityId: id,
      before: shipment,
      after: updated,
    });
    return updated;
  }

  async remove(user: RequestUser, id: string) {
    const shipment = await this.findOne(user, id);
    if (shipment.status === 'DELIVERED') {
      throw new CodedConflictException('SHIPMENT_DELETE_ALREADY_DELIVERED', 'Cannot delete a shipment that has already been delivered.');
    }

    const finishedGoodIds = (shipment.items as any[]).map((i) => i.finishedGoodId);
    await this.prisma.tenant.finishedGood.updateMany({
      where: { id: { in: finishedGoodIds }, status: 'SHIPPED' },
      data: { status: 'IN_STOCK' },
    });

    await this.prisma.tenant.shipment.delete({ where: { id } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'shipment.deleted',
      entityType: 'Shipment',
      entityId: id,
      before: shipment,
    });
    return { ok: true };
  }

  /**
   * Weight/place/volume preview for a set of FinishedGood ids, grouped by
   * assembly. "Place" (вантажне місце) degrades gracefully depending on
   * how much packaging data a given Assembly has configured: pallet count
   * if `boxesPerPallet` is set, else box count if `unitsPerBox` is set,
   * else each FinishedGood unit is its own place. Weight comes from the
   * already-existing recursive BOM weight calc (AssembliesService#
   * calculateWeight) — deliberately NOT a second stored source of truth.
   */
  async calculateMetrics(user: RequestUser, finishedGoodIds: string[]): Promise<ShipmentMetrics> {
    const finishedGoods = await this.prisma.tenant.finishedGood.findMany({
      where: { id: { in: finishedGoodIds } },
      select: { id: true, assemblyId: true },
    });
    if (finishedGoods.length !== finishedGoodIds.length) {
      throw new CodedNotFoundException('SHIPMENT_FINISHED_GOODS_NOT_FOUND', 'One or more finished goods were not found.');
    }

    const countByAssembly = new Map<string, number>();
    for (const g of finishedGoods) {
      countByAssembly.set(g.assemblyId, (countByAssembly.get(g.assemblyId) ?? 0) + 1);
    }

    const assemblies = await this.prisma.tenant.assembly.findMany({
      where: { id: { in: [...countByAssembly.keys()] } },
      select: { id: true, name: true, unitsPerBox: true, boxesPerPallet: true, boxLengthCm: true, boxWidthCm: true, boxHeightCm: true },
    });
    const assemblyById = new Map(assemblies.map((a) => [a.id, a]));

    let totalWeightKg = 0;
    let totalPlaces = 0;
    let totalVolumeM3: number | null = 0;
    let weightIncomplete = false;
    let volumeIncomplete = false;
    const breakdown: ShipmentMetricsBreakdownLine[] = [];

    for (const [assemblyId, count] of countByAssembly) {
      const assembly = assemblyById.get(assemblyId);
      const weight = await this.assembliesService.calculateWeight(user, assemblyId);
      if (!weight.complete) weightIncomplete = true;
      const lineWeightKg = weight.weightPerUnitKg * count;
      totalWeightKg += lineWeightKg;

      const unitsPerBox = assembly?.unitsPerBox ?? null;
      const boxesPerPallet = assembly?.boxesPerPallet ?? null;
      const boxes = unitsPerBox ? Math.ceil(count / unitsPerBox) : count;
      const pallets = boxesPerPallet ? Math.ceil(boxes / boxesPerPallet) : null;
      totalPlaces += pallets ?? boxes;

      const length = assembly?.boxLengthCm != null ? Number(assembly.boxLengthCm) : null;
      const width = assembly?.boxWidthCm != null ? Number(assembly.boxWidthCm) : null;
      const height = assembly?.boxHeightCm != null ? Number(assembly.boxHeightCm) : null;
      if (length != null && width != null && height != null) {
        if (totalVolumeM3 != null) totalVolumeM3 += (boxes * length * width * height) / 1_000_000;
      } else {
        volumeIncomplete = true;
        totalVolumeM3 = null;
      }

      breakdown.push({
        assemblyId,
        assemblyName: assembly?.name ?? assemblyId,
        count,
        boxes,
        pallets,
        weightKg: lineWeightKg,
      });
    }

    const transportTypes = await this.transportUnitTypesService.listActive();
    const transportSuggestions: TransportSuggestion[] = transportTypes.map((type) => {
      const maxWeightKg = Number(type.maxWeightKg);
      const maxVolumeM3 = type.maxVolumeM3 != null ? Number(type.maxVolumeM3) : null;
      const ratios = [maxWeightKg > 0 ? totalWeightKg / maxWeightKg : 0];
      if (maxVolumeM3 && totalVolumeM3 != null) ratios.push(totalVolumeM3 / maxVolumeM3);
      if (type.maxPackages) ratios.push(totalPlaces / type.maxPackages);
      return { typeId: type.id, name: type.name, unitsNeeded: Math.max(1, Math.ceil(Math.max(...ratios))) };
    });

    return { totalWeightKg, weightIncomplete, totalPlaces, totalVolumeM3, volumeIncomplete, breakdown, transportSuggestions };
  }
}
