import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssembliesService } from '../../bom/assemblies.service';
import { AiTool, AiToolContext } from './ai-tool.interface';

/** Ported from AI_TOOLS_.searchProducts / executeAiTool_'s `searchProducts` branch. */
@Injectable()
export class SearchProductsTool implements AiTool {
  readonly key = 'searchProducts';
  readonly description = 'Пошук товарів у базі складу за назвою чи артикулом. Повертає залишок, мінімальний залишок, ціни.';
  readonly parameters = {
    type: 'object',
    properties: { query: { type: 'string', description: 'Пошуковий запит' } },
    required: ['query'],
  };

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, any>, context: AiToolContext) {
    const q = String(args.query || '');
    const products = await this.prisma.tenant.product.findMany({
      where: {
        deletedAt: null,
        OR: [{ article: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }],
      },
      take: 20,
    });

    // Sell price is cost/price-sensitive data — same admin-only gate as the
    // warehouse valuation report (`reports:valuation`), mirroring the legacy
    // `user.role === 'admin'` check in `executeAiTool_`'s searchProducts branch.
    const canSeePrice = context.permissions.has('reports:valuation');

    return {
      results: products.map((p) => ({
        article: p.article,
        name: p.name,
        qty: Number(p.qty),
        minQty: Number(p.minQty),
        unit: (p as any).unitId ?? undefined,
        sellPriceEur: canSeePrice ? Number((p as any).sellPriceEur ?? 0) : undefined,
      })),
      count: products.length,
    };
  }
}

/** Ported from AI_TOOLS_.getLowStockProducts. */
@Injectable()
export class GetLowStockProductsTool implements AiTool {
  readonly key = 'getLowStockProducts';
  readonly description = 'Список товарів, залишок яких нижче мінімального — що варто замовити.';
  readonly parameters = { type: 'object', properties: {} };

  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<any> {
    const products = await this.prisma.tenant.product.findMany({ where: { deletedAt: null } });
    const items = products
      .filter((p) => Number(p.minQty) > 0 && Number(p.qty) < Number(p.minQty))
      .map((p) => ({ article: p.article, name: p.name, qty: Number(p.qty), minQty: Number(p.minQty) }))
      .slice(0, 30);
    return { items };
  }
}

/** Ported from AI_TOOLS_.searchAssemblies. `availableInStock` counts already-manufactured IN_STOCK FinishedGoods (not a from-components producible-count), matching the legacy `fgAvailability[...].count` field exactly. */
@Injectable()
export class SearchAssembliesTool implements AiTool {
  readonly key = 'searchAssemblies';
  readonly description = 'Пошук виробів за назвою чи артикулом. Повертає собівартість, кількість компонентів, наявність на складі.';
  readonly parameters = {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly assembliesService: AssembliesService,
  ) {}

  async execute(args: Record<string, any>): Promise<any> {
    const q = String(args.query || '');
    const assemblies = await this.prisma.tenant.assembly.findMany({
      where: {
        deletedAt: null,
        OR: [{ article: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }],
      },
      include: { components: true },
      take: 20,
    });

    const results = [];
    for (const a of assemblies) {
      const availableInStock = await this.prisma.tenant.finishedGood.count({
        where: { assemblyId: a.id, status: 'IN_STOCK' },
      });
      let costLocal = 0;
      try {
        const cost = await this.assembliesService.calculateCost({} as any, a.id);
        costLocal = cost.localCostPerUnit;
      } catch {
        costLocal = 0; // cycle or missing component — don't fail the whole search over one bad assembly
      }
      results.push({
        article: a.article,
        name: a.name,
        availableInStock,
        componentCount: (a as any).components?.length ?? 0,
        costEur: costLocal,
      });
    }

    return { results };
  }
}

/** Ported from AI_TOOLS_.getAssemblyDetail. */
@Injectable()
export class GetAssemblyDetailTool implements AiTool {
  readonly key = 'getAssemblyDetail';
  readonly description = 'Повна інформація про один виріб за назвою чи артикулом: з чого складається, собівартість, постачальник.';
  readonly parameters = {
    type: 'object',
    properties: { nameOrArticle: { type: 'string' } },
    required: ['nameOrArticle'],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly assembliesService: AssembliesService,
  ) {}

  async execute(args: Record<string, any>): Promise<any> {
    const q = String(args.nameOrArticle || '').toLowerCase();
    const assemblies = await this.prisma.tenant.assembly.findMany({ where: { deletedAt: null } });
    const found = assemblies.find(
      (a) => String(a.article || '').toLowerCase() === q || String(a.name).toLowerCase().includes(q),
    );
    if (!found) return { error: `Виріб не знайдено за запитом: ${args.nameOrArticle}` };

    const components = await this.prisma.tenant.assemblyComponent.findMany({ where: { assemblyId: found.id } });
    const cost = await this.assembliesService.calculateCost({} as any, found.id);

    const componentDescriptions = [];
    for (const c of components) {
      if (c.componentType === 'PRODUCT' && c.productId) {
        const product = await this.prisma.tenant.product.findUnique({ where: { id: c.productId } });
        componentDescriptions.push({ type: 'товар', article: product?.article, name: product?.name, qty: Number(c.qtyPerUnit), unit: (product as any)?.unitId });
      } else if (c.componentType === 'ASSEMBLY' && c.subAssemblyId) {
        const sub = await this.prisma.tenant.assembly.findUnique({ where: { id: c.subAssemblyId } });
        componentDescriptions.push({ type: 'виріб', name: sub?.name, qty: Number(c.qtyPerUnit) });
      }
    }

    return {
      name: found.name,
      article: found.article,
      components: componentDescriptions,
      totalCostLocal: cost.localCostPerUnit,
      defaultSupplierId: (found as any).defaultSupplierId || null,
    };
  }
}
