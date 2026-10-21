import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import {
  CreatePurchaseRequestDto,
  QueryPurchaseRequestsDto,
  SavePurchaseRequestItemsDto,
  UpdatePurchaseRequestDto,
} from './dto/purchase-request.dto';

/**
 * Заявка на прорахунок постачальнику (2026-10-21) — a non-committal,
 * single-supplier quote request. Deliberately NOT a status on PurchaseOrder
 * itself: finance.service.ts and dashboard-timeline.service.ts both read
 * every PurchaseOrder row with no status filter, so a draft/RFQ row sharing
 * that table would silently leak into spend totals and the delivery
 * timeline. Internal-only for now — no supplier-portal exposure, no
 * PDF/email; staff negotiate manually and record prices back onto the
 * request, then convert it into a real PurchaseOrder once ready.
 */
@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
  ) {}

  /**
   * Same atomic per-company counter mechanism as Quotation.number
   * (DocumentNumberingService's "INSERT ... ON CONFLICT" pattern) —
   * inlined here rather than importing QuotationsModule, which would
   * create a cycle (ProcurementModule -> QuotationsModule -> SalesModule
   * -> ProcurementModule, since SalesModule already imports ProcurementModule).
   */
  private async nextNumber(user: RequestUser): Promise<string> {
    const year = new Date().getFullYear();
    const rows = await this.prisma.tenant.$queryRaw<Array<{ lastValue: number }>>(
      Prisma.sql`
        INSERT INTO company_document_counters ("companyId", "counterKey", "lastValue", "updatedAt")
        VALUES (${user.companyId}::uuid, ${`PURCHASE_REQUEST_${year}`}, 1, now())
        ON CONFLICT ("companyId", "counterKey")
        DO UPDATE SET "lastValue" = company_document_counters."lastValue" + 1, "updatedAt" = now()
        RETURNING "lastValue"
      `,
    );
    return `ЗП-${year}-${String(Number(rows[0].lastValue)).padStart(4, '0')}`;
  }

  async create(user: RequestUser, dto: CreatePurchaseRequestDto) {
    const number = await this.nextNumber(user);
    const request = await this.prisma.tenant.purchaseRequest.create({
      data: {
        number,
        supplierId: dto.supplierId,
        supplierNameSnapshot: dto.supplierNameSnapshot,
        comment: dto.comment,
        status: 'DRAFT',
        createdById: user.userId,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            articleSnapshot: item.articleSnapshot,
            productNameSnapshot: item.productNameSnapshot,
            qty: item.qty,
            expectedPrice: item.expectedPrice,
          })),
        },
      } as any,
      include: { items: true },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.created',
      entityType: 'PurchaseRequest',
      entityId: request.id,
      after: request,
    });
    return request;
  }

  async findOne(user: RequestUser, id: string) {
    const request = await this.prisma.tenant.purchaseRequest.findUnique({ where: { id }, include: { items: true } });
    if (!request) throw new CodedNotFoundException('PURCHASE_REQUEST_NOT_FOUND', 'Purchase request not found.');
    return request;
  }

  async query(user: RequestUser, query: QueryPurchaseRequestsDto) {
    const where: Prisma.PurchaseRequestWhereInput = {};
    if (query.status) where.status = query.status as any;
    if (query.supplierId) where.supplierId = query.supplierId;

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.purchaseRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.tenant.purchaseRequest.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  private assertEditable(request: { status: string }) {
    if (request.status === 'CONVERTED' || request.status === 'CANCELLED') {
      throw new CodedBadRequestException('PURCHASE_REQUEST_CANNOT_EDIT_TERMINAL', `Cannot change a ${request.status} purchase request.`);
    }
  }

  async update(user: RequestUser, id: string, dto: UpdatePurchaseRequestDto) {
    const before = await this.findOne(user, id);
    this.assertEditable(before);
    const request = await this.prisma.tenant.purchaseRequest.update({ where: { id }, data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.updated',
      entityType: 'PurchaseRequest',
      entityId: id,
      before,
      after: request,
    });
    return request;
  }

  /** Full bulk replace — same convention as QuotationsService#saveItems: simplest correct approach for a brand-new entity with no existing-immutability constraint to work around. */
  async saveItems(user: RequestUser, id: string, dto: SavePurchaseRequestItemsDto) {
    const before = await this.findOne(user, id);
    this.assertEditable(before);

    await this.prisma.tenant.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: id } });
    await this.prisma.tenant.purchaseRequestItem.createMany({
      data: dto.items.map((item) => ({
        companyId: user.companyId,
        purchaseRequestId: id,
        productId: item.productId,
        articleSnapshot: item.articleSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        qty: item.qty,
        expectedPrice: item.expectedPrice,
      })) as any,
    });

    const after = await this.findOne(user, id);
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.items_saved',
      entityType: 'PurchaseRequest',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  /** DRAFT -> SENT marker only (no PDF/email) — editing stays allowed afterward, unlike Quotation's hard lock, since this is an internal tracker staff keep updating as the supplier calls back with prices. */
  async send(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    this.assertEditable(before);
    const request = await this.prisma.tenant.purchaseRequest.update({ where: { id }, data: { status: 'SENT', sentAt: new Date() } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.sent',
      entityType: 'PurchaseRequest',
      entityId: id,
      before,
      after: request,
    });
    return request;
  }

  async cancel(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    this.assertEditable(before);
    const request = await this.prisma.tenant.purchaseRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.cancelled',
      entityType: 'PurchaseRequest',
      entityId: id,
      before,
      after: request,
    });
    return request;
  }

  /**
   * Creates a real PurchaseOrder from the request's current items (whatever
   * expectedPrice staff has filled in by now) via PurchaseOrdersService —
   * the exact same create() path a staff member creating a PO directly
   * would hit, so the new order gets the normal ORDERED status and is
   * indistinguishable from any other PurchaseOrder. Presence of
   * convertedPurchaseOrderId alone blocks re-conversion (mirrors
   * Quotation.convertedCustomerOrderId's own convention).
   */
  async convertToOrder(user: RequestUser, id: string) {
    const request = await this.findOne(user, id);
    if (request.status === 'CONVERTED' || request.status === 'CANCELLED') {
      throw new CodedConflictException('PURCHASE_REQUEST_ALREADY_CONVERTED', `Cannot convert a ${request.status} purchase request.`);
    }

    const order = await this.purchaseOrdersService.create(user, {
      supplierId: request.supplierId ?? undefined,
      supplierNameSnapshot: request.supplierNameSnapshot,
      comment: request.comment ?? undefined,
      items: (request.items as any[]).map((item) => ({
        productId: item.productId ?? undefined,
        articleSnapshot: item.articleSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        qtyOrdered: Number(item.qty),
        expectedPrice: item.expectedPrice != null ? Number(item.expectedPrice) : undefined,
      })),
    });

    const updated = await this.prisma.tenant.purchaseRequest.update({
      where: { id },
      data: { status: 'CONVERTED', convertedPurchaseOrderId: order.id },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.converted',
      entityType: 'PurchaseRequest',
      entityId: id,
      before: request,
      after: updated,
    });

    return { purchaseOrder: order, purchaseRequest: updated };
  }

  /** DRAFT only — a sent/converted/cancelled request stays as a record (use cancel() for the reversible version of "not proceeding"). */
  async remove(user: RequestUser, id: string) {
    const request = await this.findOne(user, id);
    if (request.status !== 'DRAFT') {
      throw new CodedBadRequestException('PURCHASE_REQUEST_CANNOT_DELETE_NON_DRAFT', 'Only a DRAFT purchase request can be deleted — cancel it instead.');
    }
    await this.prisma.tenant.purchaseRequest.delete({ where: { id } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.deleted',
      entityType: 'PurchaseRequest',
      entityId: id,
      before: request,
    });
  }
}
