import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminAuditService } from './super-admin-audit.service';
import { RequestSuperAdmin } from './super-admin-context';
import { CreateCompanyDto } from '../tenancy/dto/create-company.dto';
import { CompanyService } from '../tenancy/company.service';
import { ImpersonateDto } from './dto/impersonate.dto';

/**
 * "Бачити всі компанії; входити в будь-яку компанію; ... блокувати
 * компанії; створювати компанії вручну" — the Super Admin requirement this
 * service exists for. Reads/writes through `SuperAdminPrismaService`
 * (BYPASSRLS via `super_admin_service`), never `.tenant` — there is no
 * single tenant here, the whole point is seeing across all of them.
 */
@Injectable()
export class CompaniesAdminService {
  constructor(
    private readonly prisma: SuperAdminPrismaService,
    private readonly jwt: JwtService,
    private readonly superAdminAudit: SuperAdminAuditService,
    // Reused, not reimplemented — company creation (signup transaction, all
    // per-company seeders) is exactly the same operation whether triggered
    // by public self-service signup or a Super Admin doing it manually.
    private readonly companyService: CompanyService,
  ) {}

  async list(query: { search?: string; limit?: number; offset?: number }) {
    const where = query.search
      ? { OR: [{ name: { contains: query.search, mode: 'insensitive' as const } }, { slug: { contains: query.search, mode: 'insensitive' as const } }] }
      : {};
    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: { subscription: true },
      }),
      this.prisma.company.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  async findOne(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { subscription: true, memberships: { include: { user: true, role: true } } },
    });
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }

  async create(actor: RequestSuperAdmin, dto: CreateCompanyDto) {
    const { company } = await this.companyService.createCompany(dto);
    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'company.created_manually',
      targetType: 'Company',
      targetId: company.id,
      metadata: { slug: company.slug, name: company.name },
    });
    return company;
  }

  async block(actor: RequestSuperAdmin, companyId: string) {
    const company = await this.setStatus(companyId, 'SUSPENDED');
    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'company.blocked',
      targetType: 'Company',
      targetId: companyId,
    });
    return company;
  }

  async unblock(actor: RequestSuperAdmin, companyId: string) {
    const company = await this.setStatus(companyId, 'ACTIVE');
    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'company.unblocked',
      targetType: 'Company',
      targetId: companyId,
    });
    return company;
  }

  private async setStatus(companyId: string, status: 'ACTIVE' | 'SUSPENDED') {
    const existing = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!existing) throw new NotFoundException('Company not found.');
    return this.prisma.company.update({ where: { id: companyId }, data: { status } });
  }

  /**
   * "Входити в будь-яку компанію" — mints a REGULAR access token (same
   * shape, same secret, as `AuthService.issueTokenPair`), so the rest of
   * the app needs zero special-casing to accept it. Deliberately
   * access-token-only, no refresh token: keeps an impersonation session
   * short-lived and auditable rather than a standing, easily-forgotten
   * back door. Every impersonation is logged with which user it acted as,
   * not just which company.
   */
  async impersonate(actor: RequestSuperAdmin, companyId: string, dto: ImpersonateDto) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found.');
    if (company.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot impersonate into a non-active company — unblock it first.');
    }

    const membership = dto.userId
      ? await this.prisma.companyMembership.findUnique({
          where: { companyId_userId: { companyId, userId: dto.userId } },
          include: { user: true },
        })
      : await this.prisma.companyMembership.findFirst({
          where: { companyId },
          orderBy: { createdAt: 'asc' }, // earliest membership == the original signup owner
          include: { user: true },
        });

    if (!membership) {
      throw new NotFoundException(
        dto.userId ? 'That user is not a member of this company.' : 'This company has no members to impersonate.',
      );
    }

    const accessTtl = process.env.JWT_ACCESS_TTL ?? '15m';
    const accessToken = this.jwt.sign(
      {
        sub: membership.userId,
        companyId,
        email: membership.user.email,
        roleId: membership.roleId,
        impersonatedBy: actor.superAdminId, // present only on impersonation tokens — informational, not read by any regular guard
      },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: accessTtl },
    );

    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'company.impersonated',
      targetType: 'Company',
      targetId: companyId,
      metadata: { asUserId: membership.userId, asUserEmail: membership.user.email },
    });

    return {
      accessToken,
      expiresIn: accessTtl,
      companySlug: company.slug,
      userEmail: membership.user.email,
    };
  }
}
