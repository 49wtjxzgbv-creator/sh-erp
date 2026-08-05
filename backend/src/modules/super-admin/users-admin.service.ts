import { Injectable } from '@nestjs/common';
import { SuperAdminPrismaService } from './super-admin-prisma.service';

/** "Переглядати всіх користувачів" — cross-company, read-only. */
@Injectable()
export class UsersAdminService {
  constructor(private readonly prisma: SuperAdminPrismaService) {}

  async list(query: { search?: string; limit?: number; offset?: number }) {
    const where = query.search
      ? { OR: [{ email: { contains: query.search, mode: 'insensitive' as const } }, { fullName: { contains: query.search, mode: 'insensitive' as const } }] }
      : {};
    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          email: true,
          fullName: true,
          active: true,
          createdAt: true,
          memberships: { select: { companyId: true, roleId: true, company: { select: { name: true, slug: true } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }
}
