import { Injectable, Logger } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * "якщо ми йому відправляємо товари на прорахунок чи в роботу ті товари
 * які відправляємо автоматично мають підтягуватись в каталог" (2026-11-02):
 * whenever a product is sent to a supplier via a PurchaseOrder (create()) or
 * a sent PurchaseRequest (send()), ensure a `ProductSupplier` row exists for
 * that (product, supplier) pair — `ProductSupplier` is already exactly "this
 * product is associated with this supplier, with a price" (schema.prisma),
 * so it doubles as the catalog's backing store instead of a parallel model.
 * The supplier's own portal-entered fields (`supplierCostPrice`/
 * `supplierOfferedPrice`) live on that same row, kept strictly separate
 * from staff's own `price`/`isDefault` — this service only ever
 * ensure-exists (`update: {}`), never touches either.
 *
 * Best-effort by design, same shape as
 * PurchaseRequestsService#notifySupplierPortalIfConnected: owns its own
 * try/catch and Logger, never throws, so a callsite never needs to wrap it.
 * Gated on an ACTIVE supplier-portal connection — a supplier with no portal
 * access has no catalog to populate.
 */
@Injectable()
export class SupplierCatalogService {
  private readonly logger = new Logger(SupplierCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureCatalogEntries(user: RequestUser, supplierId: string | null | undefined, productIds: (string | null | undefined)[]): Promise<void> {
    if (!supplierId) return;
    const distinctProductIds = [...new Set(productIds.filter((id): id is string => id != null))];
    if (distinctProductIds.length === 0) return;

    try {
      const connection = await this.prisma.tenant.supplierConnection.findUnique({
        where: { supplierId },
        include: { supplierOrganization: { include: { portalUser: true } } },
      });
      if (connection?.status !== 'ACTIVE' || !connection.supplierOrganization.portalUser?.active) return;

      await Promise.all(
        distinctProductIds.map((productId) =>
          this.prisma.tenant.productSupplier.upsert({
            where: { productId_supplierId: { productId, supplierId } },
            create: { companyId: user.companyId, productId, supplierId },
            update: {}, // ensure-exists only — never touch an existing row's price/isDefault/supplier-entered fields
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`Failed to ensure supplier-catalog entries (supplier=${supplierId}, products=${distinctProductIds.join(',')}): ${err}`);
    }
  }
}
