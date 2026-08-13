import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateShipmentDto, QueryShipmentsDto } from './dto/shipment.dto';

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

    const shipment = await this.prisma.tenant.shipment.create({
      data: {
        customerOrderId: dto.customerOrderId,
        carrier: dto.carrier,
        waybillNumber: dto.waybillNumber,
        packageCount: dto.packageCount,
        weightKg: dto.weightKg,
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
}
