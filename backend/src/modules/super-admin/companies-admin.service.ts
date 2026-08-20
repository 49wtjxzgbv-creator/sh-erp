import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminAuditService } from './super-admin-audit.service';
import { RequestSuperAdmin } from './super-admin-context';
import { CreateCompanyDto } from '../tenancy/dto/create-company.dto';
import { CompanyService } from '../tenancy/company.service';
import { AuthService } from '../identity/auth.service';
import { ImpersonateDto } from './dto/impersonate.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';

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
    private readonly superAdminAudit: SuperAdminAuditService,
    // Reused, not reimplemented — company creation (signup transaction, all
    // per-company seeders) is exactly the same operation whether triggered
    // by public self-service signup or a Super Admin doing it manually.
    private readonly companyService: CompanyService,
    // Reused, not reimplemented — impersonate() mints a real regular-company
    // session through the exact same issueTokenPair/rotation/reuse-detection
    // machinery a normal login uses (P0 fix, 2026-08-20), instead of
    // hand-rolling a second, unaudited JWT-signing path.
    private readonly authService: AuthService,
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
    if (!company) throw new CodedNotFoundException('COMPANY_NOT_FOUND', 'Company not found.');
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

  async update(actor: RequestSuperAdmin, companyId: string, dto: UpdateCompanyDto) {
    const existing = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!existing) throw new CodedNotFoundException('COMPANY_NOT_FOUND', 'Company not found.');

    let updated;
    try {
      updated = await this.prisma.company.update({
        where: { id: companyId },
        data: { name: dto.name, slug: dto.slug },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new CodedConflictException('COMPANY_SLUG_TAKEN', 'That slug is already taken by another company.');
      }
      throw err;
    }

    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'company.updated',
      targetType: 'Company',
      targetId: companyId,
      metadata: { before: { name: existing.name, slug: existing.slug }, after: { name: updated.name, slug: updated.slug } },
    });
    return updated;
  }

  /**
   * "Видалити учасника з компанії" — revokes access without touching the
   * User account itself (they may belong to other companies, or sign up
   * again elsewhere with the same email). Refuses to remove the last
   * remaining membership: a company with zero members is an orphaned
   * tenant nothing in the regular app UI can recover from (no "invite the
   * first user" flow exists once every membership is gone).
   */
  async removeMembership(actor: RequestSuperAdmin, companyId: string, userId: string) {
    const membership = await this.prisma.companyMembership.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!membership) throw new CodedNotFoundException('MEMBERSHIP_NOT_FOUND', 'That user is not a member of this company.');

    const memberCount = await this.prisma.companyMembership.count({ where: { companyId } });
    if (memberCount <= 1) {
      throw new CodedBadRequestException('COMPANY_LAST_MEMBER', 'Cannot remove the last remaining member of a company.');
    }

    await this.prisma.companyMembership.delete({ where: { companyId_userId: { companyId, userId } } });

    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'company.member_removed',
      targetType: 'Company',
      targetId: companyId,
      metadata: { userId },
    });
    return { removed: true };
  }

  private async setStatus(companyId: string, status: 'ACTIVE' | 'SUSPENDED') {
    const existing = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!existing) throw new CodedNotFoundException('COMPANY_NOT_FOUND', 'Company not found.');
    return this.prisma.company.update({ where: { id: companyId }, data: { status } });
  }

  /**
   * "Входити в будь-яку компанію" — mints a REAL regular-company session
   * (access + refresh token pair) via `AuthService.issueImpersonationSession`,
   * so the impersonated tab passes `middleware.ts`'s httpOnly-refresh-cookie
   * check exactly like a normal login. Not a standing back door, though:
   * the refresh token is capped by a short, non-extendable
   * `absoluteExpiresAt` ceiling (see `issueImpersonationSession`), unlike a
   * normal 30-day sliding session. Every impersonation is logged with which
   * user it acted as, not just which company.
   */
  async impersonate(actor: RequestSuperAdmin, companyId: string, dto: ImpersonateDto) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new CodedNotFoundException('COMPANY_NOT_FOUND', 'Company not found.');
    if (company.status !== 'ACTIVE') {
      throw new CodedBadRequestException('COMPANY_NOT_ACTIVE', 'Cannot impersonate into a non-active company — unblock it first.');
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
      if (dto.userId) throw new CodedNotFoundException('MEMBERSHIP_NOT_FOUND', 'That user is not a member of this company.');
      throw new CodedNotFoundException('COMPANY_NO_MEMBERS', 'This company has no members to impersonate.');
    }

    const tokens = await this.authService.issueImpersonationSession(
      membership.userId,
      companyId,
      membership.user.email,
      membership.roleId,
      actor.superAdminId,
    );

    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'company.impersonated',
      targetType: 'Company',
      targetId: companyId,
      metadata: { asUserId: membership.userId, asUserEmail: membership.user.email },
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      impersonatedBy: tokens.impersonatedBy,
      companyId,
      companySlug: company.slug,
      userId: membership.userId,
      userEmail: membership.user.email,
      roleId: membership.roleId,
    };
  }
}
