import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { SupplierPortalAuthPrismaService } from './supplier-portal-auth-prisma.service';
import { SupplierPortalAuthService, SupplierPortalSession } from './supplier-portal-auth.service';
import { AcceptSupplierInviteDto } from './dto/accept-invite.dto';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException, CodedUnauthorizedException } from '../../common/api-exceptions';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';

export interface SupplierInvitePreview {
  companyName: string;
  supplierName: string;
}

/**
 * Self-service supplier registration (2026-08-21 P1, ADR-0013) — redeeming a
 * `SupplierInviteToken` a company generated for a `Supplier` row that has no
 * portal connection yet. Runs entirely through the BYPASSRLS
 * `supplier_portal_auth_service` role (same as login/refresh/scope-check) —
 * this is the FIRST flow in the module that INSERTs new identity rows
 * through that role rather than only SELECT/UPDATE existing ones; see the
 * migration's own header comment and ADR-0013 for why that's a deliberate,
 * narrowly-gated exception rather than a quiet widening.
 */
@Injectable()
export class SupplierPortalRegistrationService {
  constructor(
    private readonly prisma: SupplierPortalAuthPrismaService,
    private readonly supplierPortalAuthService: SupplierPortalAuthService,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
  ) {}

  async preview(rawToken: string): Promise<SupplierInvitePreview> {
    const token = await this.findValidToken(rawToken);
    return { companyName: token.company.name, supplierName: token.supplier.name };
  }

  async accept(rawToken: string, dto: AcceptSupplierInviteDto): Promise<SupplierPortalSession> {
    const token = await this.findValidToken(rawToken);

    // Defensive re-check — the staff UI only offers link generation while
    // the supplier has no connection yet, but a concurrent redemption or a
    // parallel manual invitePortal() could have created one since the link
    // was generated.
    const existingConnection = await this.prisma.supplierConnection.findUnique({ where: { supplierId: token.supplierId } });
    if (existingConnection) {
      throw this.invalidInviteError();
    }

    const existingPortalUser = await this.prisma.supplierPortalUser.findUnique({ where: { email: dto.email } });

    let supplierOrganizationId: string;
    let supplierPortalUserId: string;

    if (existingPortalUser) {
      // Proof of ownership replaces the separate accept/decline step
      // `invitePortal`'s own case 2 defers to — nobody is vouching for this
      // supplier here, so a correct password IS the authorization boundary.
      const ok = await argon2.verify(existingPortalUser.passwordHash, dto.password);
      if (!ok) {
        throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
      }
      supplierOrganizationId = existingPortalUser.supplierOrganizationId;
      supplierPortalUserId = existingPortalUser.id;
    } else {
      if (!dto.organizationName) {
        throw new CodedBadRequestException(
          'SUPPLIER_ORGANIZATION_NAME_REQUIRED',
          'organizationName is required when this email has no existing Supplier Portal account.',
        );
      }
      const passwordHash = await argon2.hash(dto.password);
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const organization = await tx.supplierOrganization.create({ data: { name: dto.organizationName! } });
          const portalUser = await tx.supplierPortalUser.create({
            data: { supplierOrganizationId: organization.id, email: dto.email, passwordHash, active: true },
          });
          return { organizationId: organization.id, portalUserId: portalUser.id };
        });
        supplierOrganizationId = created.organizationId;
        supplierPortalUserId = created.portalUserId;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new CodedConflictException(
            'SUPPLIER_PORTAL_EMAIL_ALREADY_REGISTERED',
            'This email already has a Supplier Portal account — leave organizationName blank and use its password instead.',
          );
        }
        throw err;
      }
    }

    // Atomic consume-then-create: two concurrent redemptions of the same
    // token must not both succeed. The token consume is a conditional
    // updateMany (not read-then-write) so only one caller ever sees
    // count === 1; SupplierConnection.supplierId is @unique as a second,
    // independent backstop against the same race.
    let connectionId: string;
    try {
      connectionId = await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.supplierInviteToken.updateMany({
          where: { id: token.id, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        });
        if (consumed.count !== 1) {
          throw this.invalidInviteError();
        }
        const connection = await tx.supplierConnection.create({
          data: {
            companyId: token.companyId,
            supplierId: token.supplierId,
            supplierOrganizationId,
            status: 'ACTIVE',
            respondedAt: new Date(),
          },
        });
        return connection.id;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw this.invalidInviteError();
      }
      throw err;
    }

    const action = existingPortalUser ? 'supplier.connected_via_invite_link' : 'supplier.registered_via_invite_link';
    await this.auditService.record({
      companyId: token.companyId,
      actorUserId: null,
      action,
      entityType: 'SupplierConnection',
      entityId: connectionId,
      after: { supplierPortalUserId, viaInviteToken: true },
    });

    if (existingPortalUser) {
      // Cheap tripwire against a leaked-token + guessed-password takeover —
      // notifies the account's OWN registered email, not whoever just
      // authenticated (they're the same person in the legitimate case).
      await this.emailService.send(
        dto.email,
        'Нову компанію підключено до вашого акаунта — SH ERP',
        `До вашого акаунта порталу постачальника SH ERP щойно підключено нову компанію: ${token.company.name}.\nЯкщо це були не ви — негайно змініть пароль і зверніться до підтримки.`,
      );
    }

    return this.supplierPortalAuthService.issueSession(supplierPortalUserId, connectionId);
  }

  private async findValidToken(rawToken: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const token = await this.prisma.supplierInviteToken.findUnique({
      where: { tokenHash },
      include: { company: { select: { name: true } }, supplier: { select: { name: true } } },
    });
    // Same "never distinguish not-yours from doesn't-exist" convention the
    // rest of this module uses — expired/consumed/revoked/nonexistent all
    // look identical from the caller's point of view.
    if (!token || token.consumedAt || token.revokedAt || token.expiresAt < new Date()) {
      throw this.invalidInviteError();
    }
    return token;
  }

  private invalidInviteError(): CodedNotFoundException {
    return new CodedNotFoundException('SUPPLIER_INVITE_NOT_FOUND', 'This invite link is invalid, expired, or has already been used.');
  }
}
