import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { FilesService } from '../files/files.service';

export interface SearchResultItem {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  photoUrl?: string;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly filesService: FilesService,
  ) {}

  async search(user: RequestUser, q: string): Promise<SearchResults> {
    const query = q.trim();

    // An empty query still returns a page of results (most-recently-touched
    // first) instead of nothing — the dropdown opens with real positions to
    // browse as soon as the field is focused, rather than requiring the
    // user to start typing before anything appears.
    const [products, assemblies, customerOrders, suppliers] = await Promise.all([
      this.prisma.tenant.product.findMany({
        where: {
          deletedAt: null,
          ...(query
            ? { OR: [{ article: { contains: query, mode: 'insensitive' as const } }, { name: { contains: query, mode: 'insensitive' as const } }] }
            : {}),
        },
        take: RESULTS_PER_GROUP,
        orderBy: query ? undefined : { updatedAt: 'desc' },
        select: { id: true, name: true, article: true },
      }),
      this.prisma.tenant.assembly.findMany({
        where: {
          deletedAt: null,
          ...(query
            ? { OR: [{ name: { contains: query, mode: 'insensitive' as const } }, { article: { contains: query, mode: 'insensitive' as const } }] }
            : {}),
        },
        take: RESULTS_PER_GROUP,
        orderBy: query ? undefined : { updatedAt: 'desc' },
        select: { id: true, name: true, article: true },
      }),
      this.prisma.tenant.customerOrder.findMany({
        where: query
          ? {
              OR: [
                { clientName: { contains: query, mode: 'insensitive' } },
                { orderNumber: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {},
        take: RESULTS_PER_GROUP,
        orderBy: query ? undefined : { createdAt: 'desc' },
        select: { id: true, clientName: true, orderNumber: true },
      }),
      this.prisma.tenant.supplier.findMany({
        where: query ? { name: { contains: query, mode: 'insensitive' } } : {},
        take: RESULTS_PER_GROUP,
        orderBy: query ? undefined : { updatedAt: 'desc' },
        select: { id: true, name: true },
      }),
    ]);

    // Same batch-presigned-URL lookup every list view already uses
    // (files.service.ts#listForEntities) — two small groups, not one per
    // row, since this is exactly the N+1 that method exists to avoid.
    const [productPhotos, assemblyPhotos] = await Promise.all([
      this.filesService.listForEntities(user, 'Product', products.map((p) => p.id), ['PRODUCT_PHOTO']),
      this.filesService.listForEntities(user, 'Assembly', assemblies.map((a) => a.id), ['ASSEMBLY_PHOTO']),
    ]);

    return {
      products: products.map((p) => ({
        id: p.id,
        label: p.name,
        sublabel: p.article,
        href: `/catalog/${p.id}`,
        photoUrl: productPhotos[p.id]?.[0]?.downloadUrl,
      })),
      assemblies: assemblies.map((a) => ({
        id: a.id,
        label: a.name,
        sublabel: a.article ?? undefined,
        href: `/bom/${a.id}`,
        photoUrl: assemblyPhotos[a.id]?.[0]?.downloadUrl,
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
