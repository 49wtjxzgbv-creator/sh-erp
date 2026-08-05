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
