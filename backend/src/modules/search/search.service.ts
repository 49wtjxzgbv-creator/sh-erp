import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';

export interface SearchResultItem {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

export interface SearchResults {
  products: SearchResultItem[];
  assemblies: SearchResultItem[];
  customerOrders: SearchResultItem[];
  suppliers: SearchResultItem[];
}

const RESULTS_PER_GROUP = 5;

/**
 * One aggregate endpoint over the same `search`-by-name/article filters
 * each module's own list page already uses (products.service.ts,
 * assemblies.service.ts, customer-orders.service.ts, suppliers.service.ts)
 * — this doesn't reimplement matching logic, just runs the same shape of
 * query across four models in parallel and caps each group small, since
 * this backs an instant-search dropdown, not a paginated results page.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(user: RequestUser, q: string): Promise<SearchResults> {
    const query = q.trim();
    if (!query) {
      return { products: [], assemblies: [], customerOrders: [], suppliers: [] };
    }

    const [products, assemblies, customerOrders, suppliers] = await Promise.all([
      this.prisma.tenant.product.findMany({
        where: {
          deletedAt: null,
          OR: [{ article: { contains: query, mode: 'insensitive' } }, { name: { contains: query, mode: 'insensitive' } }],
        },
        take: RESULTS_PER_GROUP,
        select: { id: true, name: true, article: true },
      }),
      this.prisma.tenant.assembly.findMany({
        where: {
          deletedAt: null,
          OR: [{ name: { contains: query, mode: 'insensitive' } }, { article: { contains: query, mode: 'insensitive' } }],
        },
        take: RESULTS_PER_GROUP,
        select: { id: true, name: true, article: true },
      }),
      this.prisma.tenant.customerOrder.findMany({
        where: {
          OR: [
            { clientName: { contains: query, mode: 'insensitive' } },
            { orderNumber: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: RESULTS_PER_GROUP,
        select: { id: true, clientName: true, orderNumber: true },
      }),
      this.prisma.tenant.supplier.findMany({
        where: { name: { contains: query, mode: 'insensitive' } },
        take: RESULTS_PER_GROUP,
        select: { id: true, name: true },
      }),
    ]);

    return {
      products: products.map((p) => ({
        id: p.id,
        label: p.name,
        sublabel: p.article,
        href: `/catalog/${p.id}`,
      })),
      assemblies: assemblies.map((a) => ({
        id: a.id,
        label: a.name,
        sublabel: a.article ?? undefined,
        href: `/bom/${a.id}`,
      })),
      customerOrders: customerOrders.map((o) => ({
        id: o.id,
        label: o.clientName,
        sublabel: o.orderNumber ?? undefined,
        href: `/sales/${o.id}`,
      })),
      suppliers: suppliers.map((s) => ({
        id: s.id,
        label: s.name,
        href: `/procurement/suppliers/${s.id}`,
      })),
    };
  }
}
