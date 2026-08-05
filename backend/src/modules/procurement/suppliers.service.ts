import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { QuerySuppliersDto } from './dto/query-suppliers.dto';

/**
 * Simple CRUD (Suppliers.gs, Phase 1 §3.4). Deliberately NO delete-protection
 * against in-use references — this preserves an explicit legacy behavior,
 * not an oversight: "no delete-protection against in-use references (a PO
 * or Product/Assembly can point to a since-deleted supplier ID; UI falls
 * back to '(постачальника видалено)')." The schema already makes this safe
 * at the DB layer (`Product.defaultSupplier`/`Assembly.defaultSupplier`/
 * `PurchaseOrder.supplier` are all `onDelete: SetNull`), so a soft-deleted
 * supplier simply detaches everywhere it was referenced instead of
 * blocking the delete.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreateSupplierDto) {
    const supplier = await this.prisma.tenant.supplier.create({ data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'supplier.created',
      entityType: 'Supplier',
      entityId: supplier.id,
      after: supplier,
    });
    return supplier;
  }

  async findOne(user: RequestUser, id: string) {
    const supplier = await this.prisma.tenant.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found.');
    return supplier;
  }

  async query(user: RequestUser, query: QuerySuppliersDto) {
    const where: Prisma.SupplierWhereInput = {};
    if (!query.includeDeleted) where.deletedAt = null;
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.supplier.findMany({ where, orderBy: { name: 'asc' }, take, skip }),
      this.prisma.tenant.supplier.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  async update(user: RequestUser, id: string, dto: UpdateSupplierDto) {
    const before = await this.findOne(user, id);
    const supplier = await this.prisma.tenant.supplier.update({ where: { id }, data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'supplier.updated',
      entityType: 'Supplier',
      entityId: id,
      before,
      after: supplier,
    });
    return supplier;
  }

  async remove(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    if (before.deletedAt) {
      throw new ConflictException('Supplier is already deleted.');
    }
    const supplier = await this.prisma.tenant.supplier.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'supplier.deleted',
      entityType: 'Supplier',
      entityId: id,
      before,
    });
    return supplier;
  }
}
