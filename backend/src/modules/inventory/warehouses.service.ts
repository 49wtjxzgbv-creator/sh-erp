import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';

export const DEFAULT_WAREHOUSE_NAME = 'Основний склад'; // mirrors seedDefaultWarehouseIfEmpty_ (Phase 1 §1.4)

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Called from CompanyService at signup, inside its transaction. Guarded
   * to be idempotent — a real production incident traced back to this
   * running twice for the same company (root cause never pinned down, but
   * plausibly a retried signup request), creating a second "Основний
   * склад" with `isDefault: true` alongside the first without clearing
   * it, unlike `create()`/`update()` above which both go through
   * `clearExistingDefault()`. That silently split the company's real
   * stock across two identically-named warehouses — every write after the
   * duplicate's creation could land on either one depending on which
   * `findFirst({ isDefault: true })` call happened to return, while the
   * other warehouse's balances just sat frozen. Checking for an existing
   * default first makes a second seed call a no-op instead of a silent
   * duplicate, regardless of what triggers the repeat call.
   */
  async seedDefault(tx: Prisma.TransactionClient, companyId: string) {
    const existingDefault = await tx.warehouse.findFirst({ where: { companyId, isDefault: true, deletedAt: null } });
    if (existingDefault) return existingDefault;
    return tx.warehouse.create({
      data: { companyId, name: DEFAULT_WAREHOUSE_NAME, isDefault: true },
    });
  }

  async create(user: RequestUser, dto: CreateWarehouseDto) {
    if (dto.isDefault) {
      await this.clearExistingDefault(user);
    }
    const warehouse = await this.prisma.tenant.warehouse.create({ data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'warehouse.created',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      after: warehouse,
    });
    return warehouse;
  }

  async list(user: RequestUser) {
    return this.prisma.tenant.warehouse.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  async findOne(user: RequestUser, id: string) {
    const warehouse = await this.prisma.tenant.warehouse.findUnique({ where: { id } });
    if (!warehouse) throw new NotFoundException('Warehouse not found.');
    return warehouse;
  }

  async update(user: RequestUser, id: string, dto: UpdateWarehouseDto) {
    const before = await this.findOne(user, id);
    if (dto.isDefault) {
      await this.clearExistingDefault(user);
    }
    const warehouse = await this.prisma.tenant.warehouse.update({ where: { id }, data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'warehouse.updated',
      entityType: 'Warehouse',
      entityId: id,
      before,
      after: warehouse,
    });
    return warehouse;
  }

  /**
   * Soft delete only, and rejected outright if the warehouse still has any
   * nonzero stock (Restrict-by-default posture from decision 5 — a
   * warehouse holding real inventory should never silently disappear).
   */
  async remove(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    const stockCount = await this.prisma.tenant.warehouseStock.count({
      where: { warehouseId: id, qty: { not: 0 } },
    });
    if (stockCount > 0) {
      throw new ConflictException(
        `Cannot delete: this warehouse still holds nonzero stock for ${stockCount} product(s).`,
      );
    }
    const warehouse = await this.prisma.tenant.warehouse.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'warehouse.deleted',
      entityType: 'Warehouse',
      entityId: id,
      before,
    });
    return warehouse;
  }

  private async clearExistingDefault(user: RequestUser) {
    // Exactly one isDefault=true warehouse per company at a time (Phase 1's
    // single-implicit-default-warehouse model, still a single default even
    // though every warehouse's stock is now explicit — Phase 3 §... note on
    // WarehouseStock).
    await this.prisma.tenant.warehouse.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }
}
