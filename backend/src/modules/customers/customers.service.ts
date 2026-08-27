import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';

/**
 * Simple CRUD, deliberately mirroring SuppliersService's own shape and its
 * "no delete-protection against in-use references" precedent — a
 * CustomerOrder/Quotation pointing at a since-soft-deleted Customer stays
 * valid (CustomerOrder.customer/Quotation.customer are Restrict, not
 * SetNull, but soft-delete never removes the row, only marks deletedAt —
 * same reasoning as Supplier's own remove()).
 *
 * Genuinely additive alongside CustomerOrder.clientName (see that field's
 * own schema.prisma comment) — this service has no awareness of the 41
 * files reading clientName directly and doesn't need any; it only ever
 * writes Customer rows and the new, optional customerId link.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreateCustomerDto) {
    const customer = await this.prisma.tenant.customer.create({ data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'customer.created',
      entityType: 'Customer',
      entityId: customer.id,
      after: customer,
    });
    return customer;
  }

  async findOne(user: RequestUser, id: string) {
    const customer = await this.prisma.tenant.customer.findUnique({ where: { id } });
    if (!customer) throw new CodedNotFoundException('CUSTOMER_NOT_FOUND', 'Customer not found.');
    return customer;
  }

  async query(user: RequestUser, query: QueryCustomersDto) {
    const where: Prisma.CustomerWhereInput = {};
    if (!query.includeDeleted) where.deletedAt = null;
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.customer.findMany({ where, orderBy: { name: 'asc' }, take, skip }),
      this.prisma.tenant.customer.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  async update(user: RequestUser, id: string, dto: UpdateCustomerDto) {
    const before = await this.findOne(user, id);
    const customer = await this.prisma.tenant.customer.update({ where: { id }, data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'customer.updated',
      entityType: 'Customer',
      entityId: id,
      before,
      after: customer,
    });
    return customer;
  }

  async remove(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    if (before.deletedAt) {
      throw new CodedConflictException('CUSTOMER_ALREADY_DELETED', 'Customer is already deleted.');
    }
    const customer = await this.prisma.tenant.customer.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'customer.deleted',
      entityType: 'Customer',
      entityId: id,
      before,
    });
    return customer;
  }
}
