import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { QuerySuppliersDto } from './dto/query-suppliers.dto';
import { SupplierPortalInviteDto } from './dto/supplier-portal-invite.dto';
import { ConnectExistingSupplierDto } from './dto/connect-existing-supplier.dto';

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
  private readonly inviteLinkTtlDays = Number(process.env.SUPPLIER_INVITE_LINK_TTL_DAYS ?? 14);

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
    const supplier = await this.prisma.tenant.supplier.findUnique({
      where: { id },
      include: { connection: { include: { supplierOrganization: { include: { portalUser: true } } } } },
    });
    if (!supplier) throw new CodedNotFoundException('SUPPLIER_NOT_FOUND', 'Supplier not found.');
    const { connection, ...rest } = supplier as any;
    return { ...rest, portalUser: this.toPortalUserStatus(connection) };
  }

  /** Reverse view of ProductSupplier — "which products is this supplier linked to, and at what price" (Suppliers detail page). */
  async getLinkedProducts(user: RequestUser, supplierId: string) {
    await this.findOne(user, supplierId);
    const rows = await this.prisma.tenant.productSupplier.findMany({
      where: { supplierId },
      include: { product: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productArticle: r.product.article,
      productName: r.product.name,
      price: r.price,
      isDefault: r.isDefault,
    }));
  }

  /** Same as getLinkedProducts, for AssemblySupplier ("виріб" bought whole from this supplier). */
  async getLinkedAssemblies(user: RequestUser, supplierId: string) {
    await this.findOne(user, supplierId);
    const rows = await this.prisma.tenant.assemblySupplier.findMany({
      where: { supplierId },
      include: { assembly: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      assemblyId: r.assemblyId,
      assemblyArticle: r.assembly.article,
      assemblyName: r.assembly.name,
      price: r.price,
      isDefault: r.isDefault,
    }));
  }

  async query(user: RequestUser, query: QuerySuppliersDto) {
    const where: Prisma.SupplierWhereInput = {};
    if (!query.includeDeleted) where.deletedAt = null;
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.tenant.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        take,
        skip,
        include: { connection: { include: { supplierOrganization: { include: { portalUser: true } } } } },
      }),
      this.prisma.tenant.supplier.count({ where }),
    ]);

    // Same portalUser -> status shape as findOne — batch-included here (not
    // an N+1 per-row lookup) so list consumers (e.g. Склад's "Очікується
    // від постачальника" tab, which needs to know per-order whether that
    // order's supplier even has a portal) don't need a second round-trip.
    const items = rows.map(({ connection, ...rest }: any) => ({
      ...rest,
      portalUser: this.toPortalUserStatus(connection),
    }));

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
      throw new CodedConflictException('SUPPLIER_ALREADY_DELETED', 'Supplier is already deleted.');
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
   * Creates (or resets, or requests) Supplier Portal access for this
   * company's own Supplier row.
   *
   * Multi-company redesign (2026-08-21 P0, ADR-0012) — three distinct
   * cases, in order:
   *  1. This company already has a `SupplierConnection` for this Supplier
   *     row (any status, including REVOKED) — reset the SAME organization's
   *     password (same temp-password/email pattern as `UsersService.invite()`
   *     always used) and re-ACTIVATE the connection if it had been revoked.
   *     Never creates a new account — this is a "re-invite/reset," not a
   *     new relationship.
   *  2. No connection yet for this company, but the email already belongs
   *     to an existing `SupplierOrganization` (connected to some OTHER
   *     company already) — this used to be a hard `409
   *     SUPPLIER_PORTAL_EMAIL_IN_USE` rejection. Now creates a PENDING
   *     `SupplierConnection` instead and notifies the existing account by
   *     email; no new account/password, the supplier accepts or declines
   *     it via the portal (`POST supplier-portal/connections/:id/accept`).
   *  3. Genuinely new supplier — today's exact temp-password/email flow,
   *     wrapped in one new `SupplierOrganization` + one ACTIVE
   *     `SupplierConnection` created together.
   */
  async invitePortal(user: RequestUser, id: string, dto: SupplierPortalInviteDto) {
    const supplier = await this.prisma.tenant.supplier.findUnique({ where: { id }, include: { connection: true } });
    if (!supplier) throw new CodedNotFoundException('SUPPLIER_NOT_FOUND', 'Supplier not found.');

    const email = dto.email ?? supplier.email;
    if (!email) {
      throw new CodedBadRequestException('SUPPLIER_NO_EMAIL', 'This supplier has no email on file — provide one in the request body.');
    }

    // Case 1: re-invite/reset for a company that already has a connection
    // to this exact Supplier row.
    if (supplier.connection) {
      const tempPassword = this.generateTempPassword();
      const passwordHash = await argon2.hash(tempPassword);

      const portalUser = await this.prisma.tenant.supplierPortalUser.update({
        where: { supplierOrganizationId: supplier.connection.supplierOrganizationId },
        data: { email, passwordHash, active: true },
      });
      if (supplier.connection.status !== 'ACTIVE') {
        await this.prisma.tenant.supplierConnection.update({
          where: { id: supplier.connection.id },
          data: { status: 'ACTIVE', respondedAt: new Date(), revokedAt: null },
        });
      }

      await this.auditService.record({
        companyId: user.companyId,
        actorUserId: user.userId,
        action: 'supplier.portal_reset',
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

    // Case 2: this email already belongs to an org connected elsewhere —
    // request a new connection instead of erroring or duplicating the account.
    const existingPortalUser = await this.prisma.tenant.supplierPortalUser.findUnique({ where: { email } });
    if (existingPortalUser) {
      const connection = await this.prisma.tenant.supplierConnection.create({
        data: {
          companyId: user.companyId,
          supplierId: id,
          supplierOrganizationId: existingPortalUser.supplierOrganizationId,
          status: 'PENDING',
        },
      });
      await this.auditService.record({
        companyId: user.companyId,
        actorUserId: user.userId,
        action: 'supplier.portal_connection_requested',
        entityType: 'Supplier',
        entityId: id,
        after: { email, connectionId: connection.id },
      });
      await this.emailService.send(
        email,
        'Новий запит на підключення — SH ERP',
        `Ще одна компанія на SH ERP запросила підключити ваш існуючий акаунт порталу постачальника до себе.\nУвійдіть у портал постачальника і прийміть або відхиліть цей запит.`,
      );
      return { email, requiresAcceptance: true };
    }

    // Case 3: genuinely new supplier — unchanged temp-password/email flow,
    // wrapped in a new SupplierOrganization + one ACTIVE SupplierConnection.
    const tempPassword = this.generateTempPassword();
    const passwordHash = await argon2.hash(tempPassword);

    const organization = await this.prisma.tenant.supplierOrganization.create({ data: { name: supplier.name } });
    const portalUser = await this.prisma.tenant.supplierPortalUser.create({
      data: { supplierOrganizationId: organization.id, email, passwordHash, active: true },
    });
    await this.prisma.tenant.supplierConnection.create({
      data: { companyId: user.companyId, supplierId: id, supplierOrganizationId: organization.id, status: 'ACTIVE', respondedAt: new Date() },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'supplier.portal_invited',
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

  /**
   * Search-and-connect (2026-08-21 P2) — for a supplier who already
   * self-registered a Supplier Portal account independently (no invite
   * link, no `Supplier` row in this company yet). Staff supply the exact
   * email the supplier registered with; this creates a NEW `Supplier` row
   * for this company plus a PENDING `SupplierConnection`, mirroring
   * `invitePortal`'s own case 2 (same PENDING-connection/audit/notify
   * shape) — the difference is this path doesn't require a pre-existing
   * `Supplier` row at all, since the whole point is staff didn't have one.
   *
   * Deliberately breaks this module's usual "never distinguish exists from
   * doesn't-exist" convention: this is a staff-initiated SEARCH action they
   * chose to run, not a redemption/authorization boundary, so a clear
   * "no such account" 404 is the correct, expected UX here — not a leak.
   */
  async connectExisting(user: RequestUser, dto: ConnectExistingSupplierDto) {
    const existingPortalUser = await this.prisma.tenant.supplierPortalUser.findUnique({ where: { email: dto.email } });
    if (!existingPortalUser) {
      throw new CodedNotFoundException('SUPPLIER_PORTAL_ACCOUNT_NOT_FOUND', 'No Supplier Portal account exists with that email.');
    }

    const alreadyConnected = await this.prisma.tenant.supplierConnection.findFirst({
      where: { companyId: user.companyId, supplierOrganizationId: existingPortalUser.supplierOrganizationId },
    });
    if (alreadyConnected) {
      throw new CodedConflictException('SUPPLIER_ALREADY_CONNECTED', 'This company is already connected to that Supplier Portal account.');
    }

    const supplier = await this.prisma.tenant.supplier.create({ data: { companyId: user.companyId, name: dto.name, email: dto.email } });
    const connection = await this.prisma.tenant.supplierConnection.create({
      data: {
        companyId: user.companyId,
        supplierId: supplier.id,
        supplierOrganizationId: existingPortalUser.supplierOrganizationId,
        status: 'PENDING',
      },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'supplier.portal_connection_requested',
      entityType: 'Supplier',
      entityId: supplier.id,
      after: { email: dto.email, connectionId: connection.id },
    });
    await this.emailService.send(
      dto.email,
      'Новий запит на підключення — SH ERP',
      `Компанія на SH ERP запросила підключити ваш існуючий акаунт порталу постачальника до себе.\nУвійдіть у портал постачальника і прийміть або відхиліть цей запит.`,
    );

    return { supplierId: supplier.id, requiresAcceptance: true };
  }

  /**
   * Revokes THIS company's own connection to this supplier — never the
   * global account. Real bug fixed here (2026-08-21 P0, ADR-0012): before
   * the multi-company redesign there was only ever one company per
   * account, so flipping `SupplierPortalUser.active` and "this company's
   * access" were the same thing; now a supplier can be connected to many
   * companies, and one company deactivating it must not silently lock the
   * supplier out of every other company it works with.
   */
  async deactivatePortal(user: RequestUser, id: string) {
    const connection = await this.prisma.tenant.supplierConnection.findUnique({ where: { supplierId: id } });
    if (!connection) throw new CodedNotFoundException('SUPPLIER_PORTAL_NOT_FOUND', 'This supplier has no portal connection.');

    const updated = await this.prisma.tenant.supplierConnection.update({
      where: { id: connection.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'supplier.portal_deactivated',
      entityType: 'Supplier',
      entityId: id,
    });

    return { active: updated.status === ('ACTIVE' as typeof updated.status) };
  }

  /**
   * Self-service registration (2026-08-21 P1, ADR-0013): generates a
   * single-use, expiring token for a Supplier row that has no portal
   * connection yet, so staff don't need to already know the supplier's
   * exact portal email — the supplier redeems it themselves at
   * `/supplier-portal/register?token=...`. Only makes sense pre-connection
   * (a supplier who already has a connection should use invite/reset
   * instead, which resets a known email's password). At most one live
   * (unconsumed, unrevoked) token per supplier at a time — generating a new
   * one supersedes any outstanding one, so an old link sent to the wrong
   * place can't keep working after a fresh one is issued.
   */
  async createInviteLink(user: RequestUser, id: string) {
    const supplier = await this.prisma.tenant.supplier.findUnique({ where: { id }, include: { connection: true } });
    if (!supplier) throw new CodedNotFoundException('SUPPLIER_NOT_FOUND', 'Supplier not found.');
    if (supplier.connection) {
      throw new CodedConflictException(
        'SUPPLIER_PORTAL_ALREADY_CONNECTED',
        'This supplier already has a portal connection — use invite/reset instead of an invite link.',
      );
    }

    await this.prisma.tenant.supplierInviteToken.updateMany({
      where: { supplierId: id, consumedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const rawToken = randomUUID() + randomUUID();
    const expiresAt = new Date(Date.now() + this.inviteLinkTtlDays * 24 * 60 * 60 * 1000);
    const token = await this.prisma.tenant.supplierInviteToken.create({
      data: {
        companyId: user.companyId,
        supplierId: id,
        tokenHash: this.hashInviteToken(rawToken),
        createdById: user.userId,
        expiresAt,
      },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'supplier.invite_link_created',
      entityType: 'Supplier',
      entityId: id,
      after: { inviteTokenId: token.id, expiresAt },
    });

    return { token: rawToken, expiresAt };
  }

  async listInviteLinks(user: RequestUser, id: string) {
    return this.prisma.tenant.supplierInviteToken.findMany({
      where: { supplierId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true, consumedAt: true, revokedAt: true, createdAt: true },
    });
  }

  async revokeInviteLink(user: RequestUser, id: string, linkId: string) {
    const link = await this.prisma.tenant.supplierInviteToken.findUnique({ where: { id: linkId } });
    if (!link || link.supplierId !== id) {
      throw new CodedNotFoundException('SUPPLIER_INVITE_LINK_NOT_FOUND', 'Invite link not found.');
    }
    if (link.consumedAt || link.revokedAt) {
      throw new CodedConflictException('SUPPLIER_INVITE_LINK_ALREADY_INVALID', 'This invite link has already been used or revoked.');
    }

    const updated = await this.prisma.tenant.supplierInviteToken.update({
      where: { id: linkId },
      data: { revokedAt: new Date() },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'supplier.invite_link_revoked',
      entityType: 'Supplier',
      entityId: id,
      after: { inviteTokenId: updated.id },
    });

    return { id: updated.id, revokedAt: updated.revokedAt };
  }

  private hashInviteToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /** Shared connection -> {email, active, createdAt} shape for findOne/query — `active` is THIS company's own connection status, not the global account flag (see deactivatePortal's own comment for why that distinction matters now). */
  private toPortalUserStatus(connection: { status: string; invitedAt: Date; supplierOrganization: { portalUser: { email: string } | null } } | null) {
    if (!connection || !connection.supplierOrganization.portalUser) return null;
    return {
      email: connection.supplierOrganization.portalUser.email,
      active: connection.status === 'ACTIVE',
      createdAt: connection.invitedAt,
    };
  }

  private generateTempPassword(): string {
    // Same 18 base64url-char / ~13.5-byte-entropy shape as UsersService's
    // own temp password — short enough to relay by phone, well past every
    // password minimum.
    return randomBytes(14).toString('base64url');
  }
}
