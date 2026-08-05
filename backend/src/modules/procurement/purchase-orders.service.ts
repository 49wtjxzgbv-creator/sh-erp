import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../inventory/stock.service';
import { CreatePurchaseOrderDto, QueryPurchaseOrdersDto } from './dto/purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';

/**
 * Multi-line purchase orders with a receiving workflow (PurchaseOrders.gs,
 * Phase 1 §3.4). `receiveFromPurchaseOrder` in the legacy system called the
 * same stock-receiving function the Products page uses — here that's just
 * `StockService.applyMovement` with `type: 'RECEIVE'`, the single path
 * every stock mutation in the system goes through (Module 4's own header
 * comment). Tracks partial delivery via `PurchaseOrderItem.qtyReceived`
 * (atomic increment, same lost-update-avoidance principle as the stock
 * ledger itself) and keeps `actualPrice` distinct from `expectedPrice` so
 * realized cost can differ from what was quoted.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly stockService: StockService,
  ) {}

  async create(user: RequestUser, dto: CreatePurchaseOrderDto) {
    const order = await this.prisma.tenant.purchaseOrder.create({
      data: {
        supplierId: dto.supplierId,
        supplierNameSnapshot: dto.supplierNameSnapshot,
        expectedDeliveryDate: dto.expectedDeliveryDate,
        comment: dto.comment,
        sourceCustomerOrderId: dto.sourceCustomerOrderId,
        status: 'ORDERED',
        createdById: user.userId,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            articleSnapshot: item.articleSnapshot,
            productNameSnapshot: item.productNameSnapshot,
            qtyOrdered: item.qtyOrdered,
            expectedPrice: item.expectedPrice,
          })),
        },
      } as any,
      include: { items: true },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_order.created',
      entityType: 'PurchaseOrder',
      entityId: order.id,
      after: order,
    });
    return order;
  }

  async findOne(user: RequestUser, id: string) {
    const order = await this.prisma.tenant.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('Purchase order not found.');
    return order;
  }

  async query(user: RequestUser, query: QueryPurchaseOrdersDto) {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.status) where.status = query.status as any;
    if (query.supplierId) where.supplierId = query.supplierId;

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.purchaseOrder.findMany({ where, orderBy: { orderDate: 'desc' }, take, skip }),
      this.prisma.tenant.purchaseOrder.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  /**
   * Records receiving against one or more lines (a partial delivery is
   * just a receive() call whose lines don't cover every item, or whose
   * qtyReceived is less than what remains — receiving the same PO multiple
   * times over its life is the normal case, not an edge case). No cap is
   * enforced against over-receiving beyond qtyOrdered — the legacy system's
   * "no hidden arithmetic" philosophy (Phase 1 §6.3) extends naturally
   * here: record reality, don't silently clamp it.
   */
  async receive(user: RequestUser, id: string, dto: ReceivePurchaseOrderDto) {
    const order = await this.findOne(user, id);
    if (order.status === 'DELIVERED') {
      throw new BadRequestException('This purchase order is already fully delivered.');
    }

    const warehouseId = dto.warehouseId ?? (await this.resolveDefaultWarehouseId());
    const itemsById = new Map<string, any>();
    for (const item of order.items as any[]) {
      itemsById.set(item.id, item);
    }

    for (const line of dto.lines) {
      const item = itemsById.get(line.purchaseOrderItemId);
      if (!item) {
        throw new NotFoundException(`Purchase order item ${line.purchaseOrderItemId} does not belong to this order.`);
      }

      await this.prisma.tenant.purchaseOrderItem.update({
        where: { id: item.id },
        data: {
          qtyReceived: { increment: line.qtyReceived },
          ...(line.actualPrice !== undefined ? { actualPrice: line.actualPrice } : {}),
        },
      });

      if (item.productId) {
        await this.stockService.applyMovement(user, {
          productId: item.productId,
          warehouseId,
          type: 'RECEIVE',
          qtyDelta: line.qtyReceived,
          sourceType: 'PurchaseOrder',
          sourceId: order.id,
          comment: `Received against PO ${order.id}, item "${item.articleSnapshot}"`,
        });
      }
    }

    const refreshedItems = await this.prisma.tenant.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
    const allDelivered = refreshedItems.every((i) => Number(i.qtyReceived) >= Number(i.qtyOrdered));
    const anyReceived = refreshedItems.some((i) => Number(i.qtyReceived) > 0);
    const newStatus = allDelivered ? 'DELIVERED' : anyReceived ? 'PARTIAL' : 'ORDERED';

    const updated = await this.prisma.tenant.purchaseOrder.update({
      where: { id },
      data: { status: newStatus },
      include: { items: true },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_order.received',
      entityType: 'PurchaseOrder',
      entityId: id,
      after: { status: newStatus, lines: dto.lines },
    });

    return updated;
  }

  private async resolveDefaultWarehouseId(): Promise<string> {
    const warehouse = await this.prisma.tenant.warehouse.findFirst({ where: { isDefault: true, deletedAt: null } });
    if (!warehouse) {
      throw new BadRequestException(
        'No default warehouse configured and none specified — cannot determine where to receive stock into.',
      );
    }
    return warehouse.id;
  }
}
