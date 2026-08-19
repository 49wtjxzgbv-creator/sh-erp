import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockReservationService } from '../inventory/stock-reservation.service';
import { CustomerOrderShortageService } from './customer-order-shortage.service';
import { SaveMaterialProvisioningDecisionDto } from './dto/material-provisioning.dto';

export type MaterialProvisioningStatus =
  | 'NOT_COVERED'
  | 'PARTIALLY_RESERVED'
  | 'AWAITING_PURCHASE'
  | 'PARTIALLY_RECEIVED'
  | 'FULLY_COVERED'
  | 'ISSUED_TO_PRODUCTION';

export interface MaterialRequirementSummary {
  productId: string;
  /** The warehouse every quantity here is computed against — the app-wide default (same resolution StockService/PurchaseOrdersService/ProductionOrdersService already use), exposed so the frontend can target the right cell for the §17 reservation-breakdown drill-down. */
  warehouseId: string;
  articleSnapshot: string;
  productNameSnapshot: string;
  /** Gross BOM requirement for this order line alone (this line's qty × its assembly tree) — never netted against stock, same "no hidden arithmetic" rule the shortage engine already follows. */
  requiredQty: number;
  physicalQty: number;
  reservedByOthersQty: number;
  /** physicalQty - reservedByOthersQty — the ceiling this line itself can still draw from stock (§4). */
  availableQty: number;
  reservedForThisOrderQty: number;
  reservedFromStockQty: number;
  reservedFromPurchaseQty: number;
  orderedFromSupplierQty: number;
  receivedQty: number;
  stillExpectedQty: number;
  /** Already issued to production from this line's own reservations (§14). */
  consumedQty: number;
  /** reservedForThisOrderQty + consumedQty — "Забезпечено X/Y" numerator. */
  coveredQty: number;
  uncoveredQty: number;
  decision: { qtyFromStock: number; qtyToPurchase: number } | null;
  status: MaterialProvisioningStatus;
}

/**
 * Orchestrates the "Забезпечення матеріалами" workflow (stock-reservation
 * spec §11/§12/§13) for one customer-order line: computes the full
 * per-material coverage picture live (never stores anything derivable —
 * see OrderMaterialRequirement's own schema comment), and is the one place
 * that persists the human's explicit stock-vs-purchase split (§2) and turns
 * a stock-side decision into a real reservation immediately (§3), through
 * StockReservationService's atomic, availability-checked primitive (§16).
 *
 * Scoped to raw PRODUCT components only (CustomerOrderShortageService's
 * `getProductRequirements`, not the ASSEMBLY-buy pool) — a disclosed,
 * deliberate limitation: `PurchaseOrderItem.productId` is null for a
 * purchased-whole sub-assembly line (see `previewShortage`'s own
 * `createPurchaseOrdersFromGroups`), and `PurchaseOrdersService#receive`
 * only posts a stock movement `if (item.productId)` — meaning purchased
 * sub-assemblies have no working physical-stock-and-receipt mechanism in
 * this codebase to reserve against at all. Extending that is a separate,
 * larger gap, out of scope here.
 */
@Injectable()
export class MaterialProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly shortageService: CustomerOrderShortageService,
    private readonly stockReservationService: StockReservationService,
  ) {}

  async getItemSummary(user: RequestUser, orderId: string, itemId: string): Promise<MaterialRequirementSummary[]> {
    const item = await this.findItem(orderId, itemId);
    const productPool = await this.shortageService.getProductRequirements(item.assemblyId, Number(item.qty));
    if (productPool.size === 0) return [];

    const productIds = Array.from(productPool.keys());
    const warehouseId = await this.resolveDefaultWarehouseId();

    const [products, stocks, requirements, reservations] = await Promise.all([
      this.prisma.tenant.product.findMany({ where: { id: { in: productIds } } }),
      this.prisma.tenant.warehouseStock.findMany({ where: { productId: { in: productIds }, warehouseId } }),
      this.prisma.tenant.orderMaterialRequirement.findMany({ where: { customerOrderItemId: itemId, productId: { in: productIds } } }),
      this.prisma.tenant.stockReservation.findMany({ where: { productId: { in: productIds }, warehouseId } }),
    ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    const stockByProduct = new Map(stocks.map((s) => [s.productId, s]));
    const requirementByProduct = new Map(requirements.map((r) => [r.productId, r]));
    const requirementIds = requirements.map((r) => r.id);
    const poItems = requirementIds.length
      ? await this.prisma.tenant.purchaseOrderItem.findMany({ where: { sourceRequirementId: { in: requirementIds } } })
      : [];
    const poItemsByRequirement = new Map<string, typeof poItems>();
    for (const poItem of poItems) {
      const list = poItemsByRequirement.get(poItem.sourceRequirementId!) ?? [];
      list.push(poItem);
      poItemsByRequirement.set(poItem.sourceRequirementId!, list);
    }

    const results: MaterialRequirementSummary[] = [];
    for (const [productId, requiredQty] of productPool) {
      const product = productById.get(productId);
      const stock = stockByProduct.get(productId);
      const physicalQty = Number(stock?.qty ?? 0);
      const totalReservedQty = Number(stock?.reservedQty ?? 0);

      const myReservations = reservations.filter((r) => r.productId === productId && r.customerOrderItemId === itemId);
      const reservedFromStockQty = myReservations.filter((r) => r.source === 'STOCK').reduce((s, r) => s + Number(r.qty), 0);
      const reservedFromPurchaseQty = myReservations.filter((r) => r.source === 'PURCHASE').reduce((s, r) => s + Number(r.qty), 0);
      const consumedQty = myReservations.reduce((s, r) => s + Number(r.consumedQty), 0);
      const reservedForThisOrderQty = reservedFromStockQty + reservedFromPurchaseQty;
      const reservedByOthersQty = Math.max(totalReservedQty - reservedForThisOrderQty, 0);
      const availableQty = physicalQty - reservedByOthersQty;

      const requirement = requirementByProduct.get(productId);
      const linkedPoItems = requirement ? poItemsByRequirement.get(requirement.id) ?? [] : [];
      const orderedFromSupplierQty = linkedPoItems.reduce((s, l) => s + Number(l.qtyOrdered), 0);
      const receivedQty = linkedPoItems.reduce((s, l) => s + Number(l.qtyReceived), 0);
      const stillExpectedQty = Math.max(orderedFromSupplierQty - receivedQty, 0);

      const coveredQty = reservedForThisOrderQty + consumedQty;
      const uncoveredQty = Math.max(requiredQty - coveredQty, 0);

      results.push({
        productId,
        warehouseId,
        articleSnapshot: product?.article ?? productId,
        productNameSnapshot: product?.name ?? productId,
        requiredQty,
        physicalQty,
        reservedByOthersQty,
        availableQty,
        reservedForThisOrderQty,
        reservedFromStockQty,
        reservedFromPurchaseQty,
        orderedFromSupplierQty,
        receivedQty,
        stillExpectedQty,
        consumedQty,
        coveredQty,
        uncoveredQty,
        decision: requirement ? { qtyFromStock: Number(requirement.qtyFromStock), qtyToPurchase: Number(requirement.qtyToPurchase) } : null,
        status: this.computeStatus({ requiredQty, consumedQty, coveredQty, orderedFromSupplierQty, receivedQty, reservedFromStockQty }),
      });
    }
    return results;
  }

  private computeStatus(input: {
    requiredQty: number;
    consumedQty: number;
    coveredQty: number;
    orderedFromSupplierQty: number;
    receivedQty: number;
    reservedFromStockQty: number;
  }): MaterialProvisioningStatus {
    const EPS = 1e-6;
    if (input.requiredQty <= EPS) return 'FULLY_COVERED';
    if (input.consumedQty >= input.requiredQty - EPS) return 'ISSUED_TO_PRODUCTION';
    if (input.coveredQty >= input.requiredQty - EPS) return 'FULLY_COVERED';
    if (input.receivedQty > EPS && input.receivedQty < input.orderedFromSupplierQty - EPS) return 'PARTIALLY_RECEIVED';
    if (input.orderedFromSupplierQty > EPS && input.receivedQty <= EPS) return 'AWAITING_PURCHASE';
    if (input.reservedFromStockQty > EPS) return 'PARTIALLY_RESERVED';
    return 'NOT_COVERED';
  }

  /**
   * §2/§3: persists the split, and immediately reserves the STOCK-side
   * delta (only the delta vs. whatever was already reserved from a
   * previous save — §15-adjacent behavior for editing a decision, not just
   * setting it once). Strict: throws if the stock side isn't actually
   * available (§16), rolling back the decision save too since both run in
   * the same request transaction.
   */
  async saveDecision(user: RequestUser, orderId: string, itemId: string, productId: string, dto: SaveMaterialProvisioningDecisionDto) {
    const item = await this.findItem(orderId, itemId);
    const productPool = await this.shortageService.getProductRequirements(item.assemblyId, Number(item.qty));
    if (!productPool.has(productId)) {
      throw new CodedBadRequestException('MATERIAL_PROVISIONING_NOT_A_COMPONENT', 'This product is not a component of this order line\'s assembly tree.');
    }

    const warehouseId = await this.resolveDefaultWarehouseId();
    const existing = await this.prisma.tenant.orderMaterialRequirement.findUnique({
      where: { customerOrderItemId_productId: { customerOrderItemId: itemId, productId } },
    });
    const previousQtyFromStock = existing ? Number(existing.qtyFromStock) : 0;
    const delta = dto.qtyFromStock - previousQtyFromStock;

    if (delta > 0) {
      await this.stockReservationService.reserveFromStock(user, { productId, warehouseId, customerOrderId: orderId, customerOrderItemId: itemId }, delta);
    }

    const requirement = await this.prisma.tenant.orderMaterialRequirement.upsert({
      where: { customerOrderItemId_productId: { customerOrderItemId: itemId, productId } },
      create: {
        customerOrderId: orderId,
        customerOrderItemId: itemId,
        productId,
        qtyFromStock: dto.qtyFromStock,
        qtyToPurchase: dto.qtyToPurchase,
        createdById: user.userId,
      } as any,
      update: { qtyFromStock: dto.qtyFromStock, qtyToPurchase: dto.qtyToPurchase },
    });

    if (delta < 0) {
      await this.stockReservationService.release(
        user,
        { productId, warehouseId, customerOrderId: orderId, customerOrderItemId: itemId, source: 'STOCK' },
        -delta,
      );
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'order_material_requirement.decision_saved',
      entityType: 'OrderMaterialRequirement',
      entityId: requirement.id,
      after: { productId, qtyFromStock: dto.qtyFromStock, qtyToPurchase: dto.qtyToPurchase },
    });

    return (await this.getItemSummary(user, orderId, itemId)).find((r) => r.productId === productId);
  }

  private async findItem(orderId: string, itemId: string) {
    const item = await this.prisma.tenant.customerOrderItem.findUnique({ where: { id: itemId } });
    if (!item || item.customerOrderId !== orderId) {
      throw new CodedNotFoundException('CUSTOMER_ORDER_ITEM_NOT_FOUND', 'This item does not belong to this customer order.');
    }
    return item;
  }

  private async resolveDefaultWarehouseId(): Promise<string> {
    const warehouse = await this.prisma.tenant.warehouse.findFirst({ where: { isDefault: true, deletedAt: null } });
    if (!warehouse) {
      throw new CodedBadRequestException(
        'MATERIAL_PROVISIONING_NO_DEFAULT_WAREHOUSE',
        'No default warehouse configured — cannot determine where to reserve stock from.',
      );
    }
    return warehouse.id;
  }
}
