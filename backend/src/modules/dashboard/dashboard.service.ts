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

  /**
   * Getting-started checklist for a new company (frontend/components/domain/
   * dashboard/onboarding-checklist.tsx). Each flag is an ALL-TIME `count() >
   * 0` — unlike getSummary's "currently open" counts above, a milestone here
   * must stay true forever once reached (e.g. the one customer order a
   * company ever created might since be COMPLETED, which getSummary's
   * pendingCustomerOrders would no longer count — but onboarding shouldn't
   * un-tick a step just because the order finished).
   */
  async getOnboardingProgress(user: RequestUser) {
    const [
      productsCount,
      assembliesCount,
      suppliersCount,
      purchaseOrdersCount,
      receivedStockCount,
      customerOrdersCount,
      productionOrdersCount,
      finishedGoodsCount,
      shipmentsCount,
      employeesCount,
    ] = await Promise.all([
      this.prisma.tenant.product.count({ where: { deletedAt: null } }),
      this.prisma.tenant.assembly.count({ where: { deletedAt: null } }),
      this.prisma.tenant.supplier.count({ where: { deletedAt: null } }),
      this.prisma.tenant.purchaseOrder.count(),
      this.prisma.tenant.stockMovement.count({ where: { type: 'RECEIVE' } }),
      this.prisma.tenant.customerOrder.count(),
      this.prisma.tenant.productionOrder.count(),
      this.prisma.tenant.finishedGood.count(),
      this.prisma.tenant.shipment.count(),
      this.prisma.tenant.employee.count(),
    ]);

    return {
      hasProducts: productsCount > 0,
      hasAssemblies: assembliesCount > 0,
      hasSuppliers: suppliersCount > 0,
      hasPurchaseOrders: purchaseOrdersCount > 0,
      hasReceivedStock: receivedStockCount > 0,
      hasCustomerOrders: customerOrdersCount > 0,
      hasProductionOrders: productionOrdersCount > 0,
      hasFinishedGoods: finishedGoodsCount > 0,
      hasShipments: shipmentsCount > 0,
      hasEmployees: employeesCount > 0,
    };
  }
}
