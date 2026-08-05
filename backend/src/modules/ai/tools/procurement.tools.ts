import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiTool } from './ai-tool.interface';

const STATUS_ALIASES: Record<string, string> = {
  ordered: 'ORDERED',
  partial: 'PARTIAL',
  delivered: 'DELIVERED',
};

/** Ported from AI_TOOLS_.listPurchaseOrders. */
@Injectable()
export class ListPurchaseOrdersTool implements AiTool {
  readonly key = 'listPurchaseOrders';
  readonly description = 'Список замовлень постачальникам, за бажанням відфільтрований за статусом (ordered, delivered).';
  readonly parameters = {
    type: 'object',
    properties: { status: { type: 'string' } },
  };

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, any>): Promise<any> {
    const status = args.status ? STATUS_ALIASES[String(args.status).toLowerCase()] ?? undefined : undefined;
    const orders = await this.prisma.tenant.purchaseOrder.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { orderDate: 'desc' },
      take: 30,
    });

    const supplierIds = Array.from(new Set(orders.map((o) => o.supplierId).filter(Boolean))) as string[];
    const suppliers = supplierIds.length
      ? await this.prisma.tenant.supplier.findMany({ where: { id: { in: supplierIds } } })
      : [];
    const nameById = new Map<string, string>();
    for (const s of suppliers) nameById.set(s.id, s.name);

    return {
      orders: orders.map((o) => ({
        supplier: o.supplierId ? nameById.get(o.supplierId) ?? '(постачальника видалено)' : undefined,
        status: o.status,
        orderDate: o.orderDate,
      })),
    };
  }
}

/** Ported from AI_TOOLS_.listSuppliers. */
@Injectable()
export class ListSuppliersTool implements AiTool {
  readonly key = 'listSuppliers';
  readonly description = 'Список усіх постачальників.';
  readonly parameters = { type: 'object', properties: {} };

  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<any> {
    const suppliers = await this.prisma.tenant.supplier.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, take: 100 });
    return { suppliers };
  }
}
