import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * "правка ціни щоб було тільки через підтвердження в основній erp"
 * (2026-11-10) — review/approve/reject side of `SourcingPriceProposal`.
 * The Mini App (sourcing-bot process, `SourcingAppService#createPriceProposal`)
 * is the ONLY writer that can CREATE a row here; this service is the only
 * code path that can move one out of PENDING. Approving upserts
 * `ProductSupplier.price` directly by its own `(productId, supplierId)`
 * unique key — NOT through `ProductsService#setSuppliers` (a full
 * delete-and-recreate of every supplier link on that product), which
 * would wipe every OTHER supplier this product has nothing to do with
 * this one proposal.
 */
@Injectable()
export class PriceProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Pending proposals company-wide, newest first — the admin review queue. `user` unused: `prisma.tenant` is already request-scoped to the current tenant via the interceptor, same as every other plain tenant-scoped list query. */
  async query(_user: RequestUser) {
    const rows = await this.prisma.tenant.sourcingPriceProposal.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { id: true, article: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      product: r.product,
      supplier: r.supplier,
      proposedPriceEur: Number(r.proposedPriceEur),
      note: r.note,
      proposedByUserId: r.proposedByUserId,
      createdAt: r.createdAt,
    }));
  }

  async approve(user: RequestUser, id: string) {
    const proposal = await this.prisma.tenant.sourcingPriceProposal.findUnique({ where: { id } });
    if (!proposal) throw new CodedNotFoundException('PRICE_PROPOSAL_NOT_FOUND', 'Price proposal not found.');
    if (proposal.status !== 'PENDING') {
      throw new CodedBadRequestException('PRICE_PROPOSAL_NOT_PENDING', `This proposal is already ${proposal.status}.`);
    }

    await this.prisma.tenant.productSupplier.upsert({
      where: { productId_supplierId: { productId: proposal.productId, supplierId: proposal.supplierId } },
      create: { productId: proposal.productId, supplierId: proposal.supplierId, price: proposal.proposedPriceEur } as any,
      update: { price: proposal.proposedPriceEur },
    });

    const updated = await this.prisma.tenant.sourcingPriceProposal.update({
      where: { id },
      data: { status: 'APPROVED', reviewedByUserId: user.userId, reviewedAt: new Date() },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'sourcing_price_proposal.approved',
      entityType: 'SourcingPriceProposal',
      entityId: id,
      after: updated,
    });

    return updated;
  }

  async reject(user: RequestUser, id: string) {
    const proposal = await this.prisma.tenant.sourcingPriceProposal.findUnique({ where: { id } });
    if (!proposal) throw new CodedNotFoundException('PRICE_PROPOSAL_NOT_FOUND', 'Price proposal not found.');
    if (proposal.status !== 'PENDING') {
      throw new CodedBadRequestException('PRICE_PROPOSAL_NOT_PENDING', `This proposal is already ${proposal.status}.`);
    }

    const updated = await this.prisma.tenant.sourcingPriceProposal.update({
      where: { id },
      data: { status: 'REJECTED', reviewedByUserId: user.userId, reviewedAt: new Date() },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'sourcing_price_proposal.rejected',
      entityType: 'SourcingPriceProposal',
      entityId: id,
      after: updated,
    });

    return updated;
  }
}
