import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssembliesService } from '../../bom/assemblies.service';
import { AiTool, AiToolContext } from './ai-tool.interface';

const STATUS_ALIASES: Record<string, string> = {
  new: 'NEW',
  in_production: 'IN_PRODUCTION',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

/** Ported from AI_TOOLS_.listCustomerOrders. */
@Injectable()
export class ListCustomerOrdersTool implements AiTool {
  readonly key = 'listCustomerOrders';
  readonly description = 'Список замовлень клієнтів, за бажанням відфільтрований за статусом (new, in_production, completed, cancelled).';
  readonly parameters = {
    type: 'object',
    properties: { status: { type: 'string' } },
  };

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, any>): Promise<any> {
    const status = args.status ? STATUS_ALIASES[String(args.status).toLowerCase()] ?? undefined : undefined;
    const orders = await this.prisma.tenant.customerOrder.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return {
      orders: orders.map((o) => ({
        orderNumber: o.orderNumber,
        clientName: o.clientName,
        status: o.status,
        deadline: o.deadline,
        priority: o.priority,
      })),
    };
  }
}

/**
 * Ported from AI_TOOLS_.getCustomerOrderDetail. `percentComplete` is derived
 * here (fraction of lines whose linked ProductionOrder is COMPLETED) —
 * there's no stored percentage column in the v2 schema (Phase 3), unlike
 * whatever the legacy sheet-based `getCustomerOrder` may have cached.
 */
@Injectable()
export class GetCustomerOrderDetailTool implements AiTool {
  readonly key = 'getCustomerOrderDetail';
  readonly description = 'Повна інформація про замовлення клієнта за назвою клієнта чи номером замовлення: позиції, статуси виробництва, вартість, % виконання.';
  readonly parameters = {
    type: 'object',
    properties: { clientNameOrNumber: { type: 'string' } },
    required: ['clientNameOrNumber'],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly assembliesService: AssembliesService,
  ) {}

  async execute(args: Record<string, any>, context: AiToolContext): Promise<any> {
    const q = String(args.clientNameOrNumber || '').toLowerCase();
    const orders = await this.prisma.tenant.customerOrder.findMany({ include: { items: true } });
    const order = orders.find(
      (o) => String(o.orderNumber || '').toLowerCase() === q || String(o.clientName).toLowerCase().includes(q),
    );
    if (!order) return { error: `Замовлення не знайдено за запитом: ${args.clientNameOrNumber}` };

    const items = order.items as any[];
    let completedCount = 0;
    let totalCostLocal = 0;
    const itemLines = [];

    for (const item of items) {
      const assembly = await this.prisma.tenant.assembly.findUnique({ where: { id: item.assemblyId } });
      let productionOrderStatus: string | undefined;
      let stageName: string | undefined;
      let lineTotalLocal: number | undefined;

      // A line can have multiple production batches (План-графік §1,
      // batch-splitting) — summarize across all of them rather than a
      // single 1:1 order, which the old CustomerOrderItem.productionOrderId
      // link could never represent once splitting shipped.
      const batches = await this.prisma.tenant.productionOrder.findMany({ where: { customerOrderItemId: item.id } });
      if (batches.length === 1) {
        productionOrderStatus = batches[0].status;
      } else if (batches.length > 1) {
        const byStatus = new Map<string, number>();
        for (const b of batches) byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1);
        productionOrderStatus = Array.from(byStatus.entries()).map(([status, count]) => `${status} (${count})`).join(', ');
      }
      if (batches.length > 0 && batches.every((b) => b.status === 'COMPLETED')) completedCount += 1;
      const batchCosts = batches.map((b) => b.totalLocalCostEur).filter((c): c is NonNullable<typeof c> => c != null);
      if (batchCosts.length > 0) lineTotalLocal = batchCosts.reduce((sum, c) => sum + Number(c), 0);
      if (lineTotalLocal === undefined && assembly) {
        try {
          const cost = await this.assembliesService.calculateCost(context.user, assembly.id);
          lineTotalLocal = cost.costPerUnit * Number(item.qty);
        } catch {
          lineTotalLocal = undefined;
        }
      }
      if (lineTotalLocal !== undefined) totalCostLocal += lineTotalLocal;

      itemLines.push({
        assemblyName: assembly?.name,
        qty: Number(item.qty),
        productionOrderStatus: productionOrderStatus || 'не створено',
        stageName,
        lineTotalLocal,
      });
    }

    return {
      clientName: order.clientName,
      orderNumber: order.orderNumber,
      status: order.status,
      percentComplete: items.length ? Math.round((completedCount / items.length) * 100) : 0,
      deadline: order.deadline,
      priority: order.priority,
      comment: order.comment,
      items: itemLines,
      totalCostLocal,
    };
  }
}
