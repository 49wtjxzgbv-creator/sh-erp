import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from './stock.service';
import { RecordInventoryCountDto, StartInventorySessionDto } from './dto/inventory-session.dto';

/**
 * Stocktake workflow (Phase 1's InventorySessions/InventoryItems sheets).
 * A session snapshots each active product's current total quantity as
 * `expectedQty`; counters record `actualQty` per product; completing the
 * session posts one INVENTORY_RECONCILIATION StockMovement per discrepancy.
 *
 * Discrepancies are applied against the company's default warehouse — the
 * old system's InventoryItems sheet counted total quantity, not
 * per-warehouse, and its implicit assumption was that any adjustment
 * "lives" in the default warehouse (Phase 1 §6.6, same convention already
 * applied when materializing the default warehouse's stock in Phase 3 §6).
 */
@Injectable()
export class InventorySessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly stockService: StockService,
  ) {}

  async start(user: RequestUser, dto: StartInventorySessionDto) {
    const products = await this.prisma.tenant.product.findMany({ where: { deletedAt: null } });

    const session = await this.prisma.tenant.inventorySession.create({
      data: {
        name: dto.name,
        comment: dto.comment,
        startedById: user.userId,
        status: 'IN_PROGRESS',
      } as any,
    });

    if (products.length > 0) {
      await this.prisma.tenant.inventoryItem.createMany({
        data: products.map((p) => ({
          inventorySessionId: session.id,
          productId: p.id,
          expectedQty: p.qty,
        })) as any,
      });
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'inventory_session.started',
      entityType: 'InventorySession',
      entityId: session.id,
      after: session,
    });

    return session;
  }

  async recordCount(user: RequestUser, sessionId: string, dto: RecordInventoryCountDto) {
    const session = await this.getOpenSession(sessionId);
    const item = await this.prisma.tenant.inventoryItem.findFirst({
      where: { inventorySessionId: sessionId, productId: dto.productId },
    });
    if (!item) {
      throw new NotFoundException('This product is not part of this inventory session.');
    }
    return this.prisma.tenant.inventoryItem.update({
      where: { id: item.id },
      data: { actualQty: dto.actualQty, counted: true },
    });
  }

  async getItems(user: RequestUser, sessionId: string) {
    await this.getSessionOrThrow(sessionId);
    return this.prisma.tenant.inventoryItem.findMany({ where: { inventorySessionId: sessionId } });
  }

  async list(user: RequestUser) {
    return this.prisma.tenant.inventorySession.findMany({ orderBy: { startedAt: 'desc' } });
  }

  /**
   * Posts one INVENTORY_RECONCILIATION movement per counted item whose
   * actualQty differs from expectedQty, against the default warehouse, then
   * marks the session COMPLETED. Uncounted items are left as-is (no
   * assumption that "not counted" means "confirmed zero discrepancy").
   */
  async complete(user: RequestUser, sessionId: string) {
    const session = await this.getOpenSession(sessionId);

    const defaultWarehouse = await this.prisma.tenant.warehouse.findFirst({
      where: { isDefault: true, deletedAt: null },
    });
    if (!defaultWarehouse) {
      throw new BadRequestException('No default warehouse configured — cannot post reconciliation adjustments.');
    }

    const items = await this.prisma.tenant.inventoryItem.findMany({
      where: { inventorySessionId: sessionId, counted: true },
    });

    const discrepancies = items.filter((item) => Number(item.actualQty) !== Number(item.expectedQty));

    for (const item of discrepancies) {
      const delta = Number(item.actualQty) - Number(item.expectedQty);
      await this.stockService.applyMovement(user, {
        productId: item.productId,
        warehouseId: defaultWarehouse.id,
        type: 'INVENTORY_RECONCILIATION',
        qtyDelta: delta,
        comment: `Inventory session "${session.name}" reconciliation`,
        sourceType: 'InventorySession',
        sourceId: sessionId,
      });
    }

    const completed = await this.prisma.tenant.inventorySession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'inventory_session.completed',
      entityType: 'InventorySession',
      entityId: sessionId,
      after: { ...completed, discrepancyCount: discrepancies.length },
    });

    return { session: completed, discrepanciesReconciled: discrepancies.length };
  }

  private async getSessionOrThrow(sessionId: string) {
    const session = await this.prisma.tenant.inventorySession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Inventory session not found.');
    return session;
  }

  private async getOpenSession(sessionId: string) {
    const session = await this.getSessionOrThrow(sessionId);
    if (session.status !== 'IN_PROGRESS') {
      throw new BadRequestException('This inventory session is already completed.');
    }
    return session;
  }
}
