import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProductionOrdersService } from './production-orders.service';
import { CreateProductionScheduleSlotDto, UpdateProductionScheduleSlotDto } from './dto/production-schedule-slot.dto';

/**
 * Forward-planning half of the production schedule (the other half is just
 * reading ProductionOrder.scheduledStartAt/scheduledEndAt — see
 * ProductionScheduleService#getSchedule). A slot is a placeholder ("week of
 * March 10, ~50 units, likely Client X") that predates a real
 * ProductionOrder — and, per schema.prisma's own comment on the model, no
 * `deletedAt`/soft-delete here: unlike Products/Suppliers/etc., a slot has
 * no financial or historical significance once superseded — it's a sticky
 * note, not a business record, so a genuine DELETE is the right operation.
 */
@Injectable()
export class ProductionScheduleSlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly productionOrdersService: ProductionOrdersService,
  ) {}

  async create(user: RequestUser, dto: CreateProductionScheduleSlotDto) {
    if (dto.endAt < dto.startAt) {
      throw new CodedBadRequestException('SCHEDULE_SLOT_END_BEFORE_START', 'endAt must not be before startAt.');
    }
    const slot = await this.prisma.tenant.productionScheduleSlot.create({
      data: {
        assemblyId: dto.assemblyId,
        title: dto.title,
        plannedUnits: dto.plannedUnits,
        startAt: dto.startAt,
        endAt: dto.endAt,
        comment: dto.comment,
        createdById: user.userId,
      } as any,
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_schedule_slot.created',
      entityType: 'ProductionScheduleSlot',
      entityId: slot.id,
      after: slot,
    });
    return slot;
  }

  async findOne(user: RequestUser, id: string) {
    const slot = await this.prisma.tenant.productionScheduleSlot.findUnique({ where: { id } });
    if (!slot) throw new CodedNotFoundException('SCHEDULE_SLOT_NOT_FOUND', 'Production schedule slot not found.');
    return slot;
  }

  async update(user: RequestUser, id: string, dto: UpdateProductionScheduleSlotDto) {
    const before = await this.findOne(user, id);
    if ((before as any).convertedToProductionOrderId) {
      throw new CodedConflictException('SCHEDULE_SLOT_ALREADY_CONVERTED_EDIT', 'This slot was already converted to a real production order — edit that order instead.');
    }
    const startAt = dto.startAt ?? before.startAt;
    const endAt = dto.endAt ?? before.endAt;
    if (endAt < startAt) {
      throw new CodedBadRequestException('SCHEDULE_SLOT_END_BEFORE_START', 'endAt must not be before startAt.');
    }
    const slot = await this.prisma.tenant.productionScheduleSlot.update({ where: { id }, data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_schedule_slot.updated',
      entityType: 'ProductionScheduleSlot',
      entityId: id,
      before,
      after: slot,
    });
    return slot;
  }

  async remove(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    await this.prisma.tenant.productionScheduleSlot.delete({ where: { id } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_schedule_slot.deleted',
      entityType: 'ProductionScheduleSlot',
      entityId: id,
      before,
    });
    return { id, deleted: true };
  }

  /**
   * Turns the plan into a real ProductionOrder via the existing
   * ProductionOrdersService.create() — no duplicated order-creation logic.
   * Requires assemblyId/plannedUnits to actually be filled in by now (both
   * optional while the slot was just a rough plan); rounds plannedUnits up
   * since ProductionOrder.unitsPlanned is a whole-units count.
   */
  async convert(user: RequestUser, id: string) {
    const slot = await this.findOne(user, id);
    if ((slot as any).convertedToProductionOrderId) {
      throw new CodedConflictException('SCHEDULE_SLOT_ALREADY_CONVERTED', 'This slot was already converted to a production order.');
    }
    if (!slot.assemblyId) {
      throw new CodedBadRequestException('SCHEDULE_SLOT_NO_ASSEMBLY', 'This slot has no assembly assigned yet — set one before converting.');
    }
    if (slot.plannedUnits == null || Number(slot.plannedUnits) <= 0) {
      throw new CodedBadRequestException('SCHEDULE_SLOT_NO_PLANNED_UNITS', 'This slot has no planned unit count yet — set one before converting.');
    }

    const order = await this.productionOrdersService.create(user, {
      assemblyId: slot.assemblyId,
      unitsPlanned: Math.ceil(Number(slot.plannedUnits)),
      comment: slot.comment ?? undefined,
      scheduledStartAt: slot.startAt,
      scheduledEndAt: slot.endAt,
    });

    const updatedSlot = await this.prisma.tenant.productionScheduleSlot.update({
      where: { id },
      data: { convertedToProductionOrderId: order.id } as any,
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_schedule_slot.converted',
      entityType: 'ProductionScheduleSlot',
      entityId: id,
      after: { productionOrderId: order.id },
    });

    return { slot: updatedSlot, productionOrder: order };
  }
}
