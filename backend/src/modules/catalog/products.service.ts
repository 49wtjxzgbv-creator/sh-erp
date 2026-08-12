import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';

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
    if (!product) throw new NotFoundException('Product not found.');
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
    if (query.search) {
      where.OR = [
        { article: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.tenant.product.findMany({ where, orderBy: { name: 'asc' }, take, skip }),
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

  private translatePrismaError(err: unknown, article?: string): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return new ConflictException(`A product with article "${article}" already exists.`);
      }
      if (err.code === 'P2003' || err.code === 'P2025') {
        return new NotFoundException(
          'Referenced unit or supplier does not exist for this company (composite FK, decision 4).',
        );
      }
    }
    return err as Error;
  }
}
