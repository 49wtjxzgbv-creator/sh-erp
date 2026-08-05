import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiTool } from './ai-tool.interface';

const STATUS_ALIASES: Record<string, string> = {
  planned: 'PLANNED',
  in_progress: 'IN_PROGRESS',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

/** Ported from AI_TOOLS_.listProductionOrders. */
@Injectable()
export class ListProductionOrdersTool implements AiTool {
  readonly key = 'listProductionOrders';
  readonly description = 'Список виробничих замовлень, за бажанням відфільтрований за статусом (planned, in_progress, completed).';
  readonly parameters = {
    type: 'object',
    properties: { status: { type: 'string' } },
  };

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, any>): Promise<any> {
    const status = args.status ? STATUS_ALIASES[String(args.status).toLowerCase()] ?? undefined : undefined;
    const orders = await this.prisma.tenant.productionOrder.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const assemblyIds = Array.from(new Set(orders.map((o) => o.assemblyId)));
    const assemblies = assemblyIds.length
      ? await this.prisma.tenant.assembly.findMany({ where: { id: { in: assemblyIds } } })
      : [];
    const nameById = new Map<string, string>();
    for (const a of assemblies) nameById.set(a.id, a.name);

    return {
      orders: orders.map((o) => ({
        assemblyName: nameById.get(o.assemblyId) ?? o.assemblyId,
        unitsPlanned: Number(o.unitsPlanned),
        status: o.status,
        createdAt: o.createdAt,
      })),
    };
  }
}

/**
 * Ported from `findProductionDelays_` (AI_FullAssistant.gs): flags orders
 * stuck ≥3 days PLANNED-and-not-started, or ≥3 days since their last stage
 * advance. The legacy version read a `StageHistoryJson` blob; the v2 schema
 * has a real `ProductionOrderStageEvent` table (Phase 3 expansion), so "last
 * stage advance" here is `MAX(createdAt)` per order rather than parsing JSON.
 */
@Injectable()
export class FindProductionDelaysTool implements AiTool {
  readonly key = 'findProductionDelays';
  readonly description = 'Знаходить виробничі замовлення, які "застрягли" — довго заплановані, але не запущені, або давно не просувались по етапах. Допомагає знайти причини простоїв.';
  readonly parameters = { type: 'object', properties: {} };

  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<any> {
    const orders = await this.prisma.tenant.productionOrder.findMany({
      where: { status: { in: ['PLANNED', 'IN_PROGRESS'] } },
    });
    if (orders.length === 0) return { delays: [] };

    const assemblyIds = Array.from(new Set(orders.map((o) => o.assemblyId)));
    const assemblies = await this.prisma.tenant.assembly.findMany({ where: { id: { in: assemblyIds } } });
    const nameById = new Map<string, string>();
    for (const a of assemblies) nameById.set(a.id, a.name);

    const inProgressIds = orders.filter((o) => o.status === 'IN_PROGRESS').map((o) => o.id);
    const stageEvents = inProgressIds.length
      ? await this.prisma.tenant.productionOrderStageEvent.findMany({ where: { productionOrderId: { in: inProgressIds } } })
      : [];
    const lastStageAtByOrder = new Map<string, Date>();
    for (const event of stageEvents) {
      const existing = lastStageAtByOrder.get(event.productionOrderId);
      if (!existing || event.createdAt > existing) lastStageAtByOrder.set(event.productionOrderId, event.createdAt);
    }

    const now = Date.now();
    const DAY_MS = 1000 * 60 * 60 * 24;
    const result: Array<{ assemblyName: string; status: string; daysStuck: number }> = [];

    for (const order of orders) {
      const assemblyName = nameById.get(order.assemblyId) ?? order.assemblyId;
      if (order.status === 'PLANNED') {
        const daysSinceCreated = Math.floor((now - order.createdAt.getTime()) / DAY_MS);
        if (daysSinceCreated >= 3) {
          result.push({ assemblyName, status: 'заплановано, не запущено', daysStuck: daysSinceCreated });
        }
      } else if (order.status === 'IN_PROGRESS') {
        const lastStageAt = lastStageAtByOrder.get(order.id) ?? order.createdAt;
        const daysSinceStage = Math.floor((now - lastStageAt.getTime()) / DAY_MS);
        if (daysSinceStage >= 3) {
          result.push({ assemblyName, status: 'в роботі, застрягло на етапі', daysStuck: daysSinceStage });
        }
      }
    }

    result.sort((a, b) => b.daysStuck - a.daysStuck);
    return { delays: result.slice(0, 20) };
  }
}

/**
 * Ported from `forecastPurchaseNeeds_`: 60-day consumption rate from the
 * stock ledger (`StockMovement.qtyDelta < 0`, the v2 replacement for the
 * legacy History sheet's negative-Qty rows), projecting days-until-empty and
 * a suggested 30-day reorder quantity.
 */
@Injectable()
export class ForecastPurchaseNeedsTool implements AiTool {
  readonly key = 'forecastPurchaseNeeds';
  readonly description = 'Аналізує темп витрати товарів за останні 60 днів (з історії складу) і прогнозує, коли товар закінчиться та скільки варто замовити. Якщо запит порожній — аналізує всі товари з помітним рухом.';
  readonly parameters = {
    type: 'object',
    properties: { articleOrQuery: { type: 'string', description: 'Артикул чи назва товару, або порожньо для всіх' } },
  };

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, any>): Promise<any> {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const movements = await this.prisma.tenant.stockMovement.findMany({
      where: { createdAt: { gte: cutoff }, qtyDelta: { lt: 0 } },
    });
    if (movements.length === 0) return { forecast: [] };

    const consumptionByProduct = new Map<string, number>();
    for (const m of movements) {
      consumptionByProduct.set(m.productId, (consumptionByProduct.get(m.productId) ?? 0) + Math.abs(Number(m.qtyDelta)));
    }

    const productIds = Array.from(consumptionByProduct.keys());
    const products = await this.prisma.tenant.product.findMany({ where: { id: { in: productIds } } });
    const productById = new Map<string, any>();
    for (const p of products) productById.set(p.id, p);

    const q = String(args.articleOrQuery || '').toLowerCase().trim();
    const forecast: Array<{
      article: string;
      name: string;
      currentQty: number;
      avgDailyConsumption: number;
      daysUntilEmpty: number;
      suggestedOrderQty: number;
    }> = [];

    for (const [productId, totalOut] of consumptionByProduct) {
      const product = productById.get(productId);
      if (!product) continue;
      if (q && !String(product.article || '').toLowerCase().includes(q) && !String(product.name || '').toLowerCase().includes(q)) continue;

      const dailyRate = totalOut / 60;
      if (dailyRate <= 0) continue;
      const currentQty = Number(product.qty);
      forecast.push({
        article: product.article,
        name: product.name,
        currentQty,
        avgDailyConsumption: Math.round(dailyRate * 100) / 100,
        daysUntilEmpty: Math.round(currentQty / dailyRate),
        suggestedOrderQty: Math.ceil(dailyRate * 30), // enough for another 30 days at the same rate
      });
    }

    forecast.sort((a, b) => a.daysUntilEmpty - b.daysUntilEmpty);
    return { forecast: forecast.slice(0, 25) };
  }
}
