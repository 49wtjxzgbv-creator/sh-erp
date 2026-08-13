import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { QuerySuppliersDto } from './dto/query-suppliers.dto';
import { SupplierPortalInviteDto } from './dto/supplier-portal-invite.dto';

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
    private readonly emailService: EmailService,
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
    const supplier = await this.prisma.tenant.supplier.findUnique({ where: { id }, include: { portalUser: true } });
    if (!supplier) throw new NotFoundException('Supplier not found.');
    const { portalUser, ...rest } = supplier as any;
    return {
      ...rest,
      portalUser: portalUser ? { email: portalUser.email, active: portalUser.active, createdAt: portalUser.createdAt } : null,
    };
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

  /**
   * Creates (or resets, for a supplier that already has a portal account)
   * a Supplier Portal login — same temp-password/email pattern as
   * `UsersService.invite()`, deliberately: generate, hash with argon2,
   * email it, and also return it once in the response since
   * `EmailService.send` can silently not-deliver (its own header comment).
   * `SupplierPortalUser.email` is globally unique (see its schema comment)
   * — checked explicitly here first, rather than letting a Prisma unique-
   * constraint violation surface as a raw 500.
   */
  async invitePortal(user: RequestUser, id: string, dto: SupplierPortalInviteDto) {
    const supplier = await this.prisma.tenant.supplier.findUnique({ where: { id }, include: { portalUser: true } });
    if (!supplier) throw new NotFoundException('Supplier not found.');

    const email = dto.email ?? supplier.email;
    if (!email) {
      throw new BadRequestException('This supplier has no email on file — provide one in the request body.');
    }

    const existingByEmail = await this.prisma.tenant.supplierPortalUser.findUnique({ where: { email } });
    if (existingByEmail && existingByEmail.supplierId !== id) {
      throw new ConflictException('This email is already used by a different supplier’s portal account.');
    }

    const tempPassword = this.generateTempPassword();
    const passwordHash = await argon2.hash(tempPassword);

    const portalUser = await this.prisma.tenant.supplierPortalUser.upsert({
      where: { supplierId: id },
      create: { companyId: user.companyId, supplierId: id, email, passwordHash, active: true },
      update: { email, passwordHash, active: true },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: (supplier as any).portalUser ? 'supplier.portal_reset' : 'supplier.portal_invited',
      entityType: 'Supplier',
      entityId: id,
      after: { email: portalUser.email },
    });

    await this.emailService.send(
      email,
      'Доступ до порталу постачальника SH ERP',
      `Вам надано доступ до порталу постачальника SH ERP.\nЕл. пошта: ${email}\nТимчасовий пароль: ${tempPassword}\nУвійдіть на сторінці порталу постачальника.`,
    );

    return { email: portalUser.email, tempPassword };
  }

  async deactivatePortal(user: RequestUser, id: string) {
    const portalUser = await this.prisma.tenant.supplierPortalUser.findUnique({ where: { supplierId: id } });
    if (!portalUser) throw new NotFoundException('This supplier has no portal account.');

    const updated = await this.prisma.tenant.supplierPortalUser.update({
      where: { supplierId: id },
      data: { active: false },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'supplier.portal_deactivated',
      entityType: 'Supplier',
      entityId: id,
    });

    return { email: updated.email, active: updated.active };
  }

  private generateTempPassword(): string {
    // Same 18 base64url-char / ~13.5-byte-entropy shape as UsersService's
    // own temp password — short enough to relay by phone, well past every
    // password minimum.
    return randomBytes(14).toString('base64url');
  }
}
