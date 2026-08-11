import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';

/**
 * Backs the app's landing page (frontend/app/(app)/dashboard/page.tsx),
 * which until now deliberately showed no real numbers at all (see that
 * file's own header comment) pending this endpoint. Every count here is a
 * cheap `count()`/small `findMany()` — no heavy joins — since this loads
 * on every login regardless of role.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(user: RequestUser) {
    const [
      productsCount,
      assembliesCount,
      products,
      activeProductionOrders,
      pendingCustomerOrders,
      openPurchaseOrders,
      activeEmployees,
    ] = await Promise.all([
      this.prisma.tenant.product.count({ where: { deletedAt: null } }),
      this.prisma.tenant.assembly.count({ where: { deletedAt: null } }),
      // Mirrors low-stock-digest.service.ts's own filter — the simple
      // "below minQty" count, not reports.service.ts's stricter
      // reservation-aware reorder-suggestion metric.
      this.prisma.tenant.product.findMany({
        where: { deletedAt: null },
        select: { qty: true, minQty: true },
      }),
      this.prisma.tenant.productionOrder.count({ where: { status: { in: ['PLANNED', 'IN_PROGRESS'] } } }),
      this.prisma.tenant.customerOrder.count({ where: { status: { in: ['NEW', 'IN_PRODUCTION'] } } }),
      this.prisma.tenant.purchaseOrder.count({ where: { status: { in: ['ORDERED', 'PARTIAL'] } } }),
      this.prisma.tenant.employee.count({ where: { status: 'ACTIVE' } }),
    ]);

    const lowStockCount = products.filter((p) => Number(p.minQty) > 0 && Number(p.qty) < Number(p.minQty)).length;

    return {
      productsCount,
      assembliesCount,
      lowStockCount,
      activeProductionOrders,
      pendingCustomerOrders,
      openPurchaseOrders,
      activeEmployees,
    };
  }
}
