import { Injectable } from '@nestjs/common';
import { SupplierPortalAuthPrismaService } from './supplier-portal-auth-prisma.service';
import { RequestSupplierPortalUser } from './supplier-portal-context';
import { CodedNotFoundException } from '../../common/api-exceptions';

/**
 * Cross-company by nature (2026-08-21 P0, ADR-0012) — the whole point is
 * listing/accepting/declining connections to companies OTHER than
 * whichever one is currently active, so this deliberately goes through the
 * BYPASSRLS `SupplierPortalAuthPrismaService` (same client login/refresh
 * already use), never the regular RLS-scoped `.tenant` client. No purchase
 * order counts here on purpose: `supplier_portal_auth_service` is only
 * granted on the 4 tables ADR-0012 documents; adding `purchase_orders` as a
 * 5th just to display a number on the selector isn't worth widening that
 * BYPASSRLS role's reach. The real order list is one click away, after
 * switching.
 */
@Injectable()
export class SupplierPortalConnectionsService {
  constructor(private readonly prisma: SupplierPortalAuthPrismaService) {}

  async list(actor: RequestSupplierPortalUser) {
    const connections = await this.prisma.supplierConnection.findMany({
      where: { supplierOrganizationId: actor.supplierOrganizationId, status: { in: ['ACTIVE', 'PENDING'] } },
      include: { company: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return connections.map((c) => ({
      id: c.id,
      companyId: c.companyId,
      companyName: c.company.name,
      status: c.status,
      invitedAt: c.invitedAt,
    }));
  }

  async accept(actor: RequestSupplierPortalUser, connectionId: string) {
    const connection = await this.resolvePending(actor, connectionId);
    const updated = await this.prisma.supplierConnection.update({
      where: { id: connection.id },
      data: { status: 'ACTIVE', respondedAt: new Date() },
      include: { company: { select: { name: true } } },
    });
    return { id: updated.id, companyId: updated.companyId, companyName: updated.company.name, status: updated.status };
  }

  async decline(actor: RequestSupplierPortalUser, connectionId: string) {
    const connection = await this.resolvePending(actor, connectionId);
    const updated = await this.prisma.supplierConnection.update({
      where: { id: connection.id },
      data: { status: 'REVOKED', respondedAt: new Date(), revokedAt: new Date() },
    });
    return { id: updated.id, status: updated.status };
  }

  /**
   * Same "never distinguish not-yours from doesn't-exist" convention as
   * SupplierPortalService#getPurchaseOrder and the auth-service's own
   * switchConnection() — a PENDING connection belonging to a different
   * organization looks identical to one that doesn't exist.
   */
  private async resolvePending(actor: RequestSupplierPortalUser, connectionId: string) {
    const connection = await this.prisma.supplierConnection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.supplierOrganizationId !== actor.supplierOrganizationId || connection.status !== 'PENDING') {
      throw new CodedNotFoundException(
        'SUPPLIER_PORTAL_CONNECTION_NOT_FOUND',
        'This connection request does not exist or has already been resolved.',
      );
    }
    return connection;
  }
}
