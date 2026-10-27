import { Injectable } from '@nestjs/common';
import { CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateTransportUnitTypeDto, UpdateTransportUnitTypeDto } from './dto/transport-unit-type.dto';

/**
 * Small reference catalogue of truck/container types (name + max weight/
 * volume/package-count), read by ShipmentsService#calculateMetrics to
 * suggest how many of each a given shipment's cargo needs. No other
 * entity references a row here, so remove() is a plain soft-delete with
 * no use-count guard (unlike WarehousesService#remove).
 */
@Injectable()
export class TransportUnitTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreateTransportUnitTypeDto) {
    const type = await this.prisma.tenant.transportUnitType.create({ data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'transportUnitType.created',
      entityType: 'TransportUnitType',
      entityId: type.id,
      after: type,
    });
    return type;
  }

  async list(user: RequestUser) {
    return this.prisma.tenant.transportUnitType.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  async findOne(user: RequestUser, id: string) {
    const type = await this.prisma.tenant.transportUnitType.findUnique({ where: { id } });
    if (!type) throw new CodedNotFoundException('TRANSPORT_UNIT_TYPE_NOT_FOUND', 'Transport unit type not found.');
    return type;
  }

  async update(user: RequestUser, id: string, dto: UpdateTransportUnitTypeDto) {
    const before = await this.findOne(user, id);
    const type = await this.prisma.tenant.transportUnitType.update({ where: { id }, data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'transportUnitType.updated',
      entityType: 'TransportUnitType',
      entityId: id,
      before,
      after: type,
    });
    return type;
  }

  async remove(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    const type = await this.prisma.tenant.transportUnitType.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'transportUnitType.deleted',
      entityType: 'TransportUnitType',
      entityId: id,
      before,
    });
    return type;
  }

  /** Active, non-deleted types — used internally by ShipmentsService#calculateMetrics, no permission check of its own. */
  async listActive() {
    return this.prisma.tenant.transportUnitType.findMany({ where: { deletedAt: null, active: true }, orderBy: { name: 'asc' } });
  }
}
