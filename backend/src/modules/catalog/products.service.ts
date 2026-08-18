import { Injectable } from '@nestjs/common';
import { CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { SetProductSuppliersDto } from './dto/product-supplier.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreateProductDto) {
    try {
      const product = await this.prisma.tenant.product.create({ data: dto as any });
      await this.auditService.record({
        companyId: user.companyId,
        actorUserId: user.userId,
        action: 'product.created',
        entityType: 'Product',
        entityId: product.id,
        after: product,
      });
      return product;
    } catch (err) {
      throw this.translatePrismaError(err, dto.article);
    }
  }

  async findOne(user: RequestUser, id: string) {
    const product = await this.prisma.tenant.product.findUnique({ where: { id } });
    if (!product) throw new CodedNotFoundException('PRODUCT_NOT_FOUND', 'Product not found.');
    return product;
  }

  /**
   * Many products in one call by id — avoids an N-request fan-out from a
   * list view that only has `productId`s to resolve into names (e.g. Stock
   * Levels, which shows raw `WarehouseStock.productId` today; see that
   * page's own header comment). Mirrors `FilesService.listForEntities`'s
   * batch shape/reasoning.
   */
  async findByIds(user: RequestUser, ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.tenant.product.findMany({ where: { id: { in: ids } } });
  }

  async query(user: RequestUser, query: QueryProductsDto) {
    const where: Prisma.ProductWhereInput = {};
    if (!query.includeDeleted) where.deletedAt = null;
    if (query.category) where.category = query.category;
    if (query.barcode) where.barcode = query.barcode;
    if (query.supplierId) where.defaultSupplierId = query.supplierId;
    if (query.search) {
      where.OR = [
        { article: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      query.sort === 'newest' ? { createdAt: 'desc' } : { name: 'asc' };

    const [items, total] = await Promise.all([
      this.prisma.tenant.product.findMany({ where, orderBy, take, skip }),
      this.prisma.tenant.product.count({ where }),
    ]);

    return { items, total, limit: take, offset: skip };
  }

  async update(user: RequestUser, id: string, dto: UpdateProductDto) {
    const before = await this.findOne(user, id);
    try {
      const product = await this.prisma.tenant.product.update({ where: { id }, data: dto as any });
      await this.auditService.record({
        companyId: user.companyId,
        actorUserId: user.userId,
        action: 'product.updated',
        entityType: 'Product',
        entityId: id,
        before,
        after: product,
      });
      return product;
    } catch (err) {
      throw this.translatePrismaError(err, dto.article);
    }
  }

  /** Soft delete only — matches the schema-wide convention (Phase 3 §1); a product with order/stock history is never hard-removed. */
  async remove(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    const product = await this.prisma.tenant.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'product.deleted',
      entityType: 'Product',
      entityId: id,
      before,
    });
    return product;
  }

  /**
   * One request soft-deletes every id, instead of the frontend firing N
   * parallel `DELETE /products/:id` calls — real incident: a "select all"
   * bulk delete of ~140 products blew straight through the global
   * per-client rate limit (`app.module.ts`'s `ThrottlerModule`, 100
   * req/60s), so only however many requests fit under whatever budget was
   * left actually succeeded and the rest silently 429'd. A single request
   * doesn't touch that limit at all, however many rows it covers.
   */
  async bulkRemove(user: RequestUser, ids: string[]) {
    const products = await this.prisma.tenant.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
    });
    if (products.length === 0) return { deletedCount: 0 };

    await this.prisma.tenant.product.updateMany({
      where: { id: { in: products.map((p) => p.id) } },
      data: { deletedAt: new Date() },
    });

    await Promise.all(
      products.map((before) =>
        this.auditService.record({
          companyId: user.companyId,
          actorUserId: user.userId,
          action: 'product.deleted',
          entityType: 'Product',
          entityId: before.id,
          before,
        }),
      ),
    );

    return { deletedCount: products.length };
  }

  /** Linked suppliers, each with its own optional price — joined with the supplier's name so the frontend never needs a second round-trip. */
  async getSuppliers(user: RequestUser, productId: string) {
    await this.findOne(user, productId);
    const rows = await this.prisma.tenant.productSupplier.findMany({
      where: { productId },
      include: { supplier: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      supplierId: r.supplierId,
      supplierName: r.supplier.name,
      price: r.price,
      isDefault: r.isDefault,
    }));
  }

  /**
   * Replace-set, same convention as AssembliesService#setComponents: delete
   * every existing row and re-create the provided list in one go — no
   * partial-update endpoint, so every save is a clean, fully-specified set.
   *
   * The default supplier's price (when present) also overwrites
   * `sellPriceEur` — the one cost basis every BOM/valuation calculation in
   * this app is pinned to (assemblies.service.ts's own header comment).
   * `sellPriceEur` stays a plain editable field on the product form too
   * (manual override), so this is "last write wins", same as the other
   * sync point in PurchaseOrdersService#receive.
   */
  async setSuppliers(user: RequestUser, productId: string, dto: SetProductSuppliersDto) {
    await this.findOne(user, productId);
    await this.prisma.tenant.productSupplier.deleteMany({ where: { productId } });
    if (dto.suppliers.length > 0) {
      await this.prisma.tenant.productSupplier.createMany({
        data: dto.suppliers.map((line) => ({
          productId,
          supplierId: line.supplierId,
          price: line.price,
          isDefault: line.isDefault ?? false,
        })) as any,
      });
    }
    const defaultLine = dto.suppliers.find((line) => line.isDefault && line.price !== undefined);
    if (defaultLine) {
      await this.prisma.tenant.product.update({ where: { id: productId }, data: { sellPriceEur: defaultLine.price } });
    }
    return this.getSuppliers(user, productId);
  }

  private translatePrismaError(err: unknown, article?: string): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return new CodedConflictException('PRODUCT_ARTICLE_ALREADY_EXISTS', `A product with article "${article}" already exists.`);
      }
      if (err.code === 'P2003' || err.code === 'P2025') {
        return new CodedNotFoundException(
          'PRODUCT_REFERENCED_ENTITY_NOT_FOUND',
          'Referenced unit or supplier does not exist for this company (composite FK, decision 4).',
        );
      }
    }
    return err as Error;
  }
}
