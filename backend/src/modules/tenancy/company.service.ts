import { ConflictException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RolesService } from '../authorization/roles.service';
import { BillingService } from '../billing/billing.service';
import { CompanyUnitsService } from '../catalog/company-units.service';
import { WarehousesService } from '../inventory/warehouses.service';
import { CreateCompanyDto } from './dto/create-company.dto';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rolesService: RolesService,
    private readonly companyUnitsService: CompanyUnitsService,
    private readonly warehousesService: WarehousesService,
    private readonly billingService: BillingService,
  ) {}

  /**
   * Company signup.
   *
   * FIXED (found while implementing the approved `auth_service` role,
   * same underlying class of bug as database-schema.md §2c): this used to
   * run its whole body on the raw, non-transactional Prisma client
   * (`this.prisma.$transaction`, not `.tenant`/`runInTenantTransaction`).
   * `Company` and `User` aren't RLS-scoped, so their own inserts were
   * always fine — but every OTHER write in this transaction
   * (`CompanyMembership`, `CompanySettings`, and, via the seeders below,
   * `Role`/`RolePermission`/`CompanyUnit`/`Warehouse`) targets a
   * FORCE-RLS tenant-scoped table (tenant-scoped-models.ts). With no
   * `SET LOCAL app.current_company_id` ever issued, those inserts would be
   * rejected by Postgres outright the first time this ran against a real
   * RLS-enabled database — company signup would have been completely
   * broken, not just degraded.
   *
   * Fix: generate the company's and owner's ids client-side (Prisma allows
   * an explicit `id` on create), then open the transaction via
   * `PrismaService.runInTenantTransaction` with that companyId already
   * known — so `SET LOCAL` is active from the very first statement, and
   * every tenant-scoped write in this transaction (including everything
   * the per-module seeders below do) is correctly RLS-scoped. No schema or
   * architecture change — `runInTenantTransaction` already existed
   * exactly for this (Phase 2 §11.4); this was a Module 1 implementation
   * bug, not a Phase 0-4 design gap.
   *
   * Seeds every default owned by another module (RolesService,
   * CompanyUnitsService, WarehousesService, BillingService) via their
   * `seedDefaultRoles(tx, ...)` / `seedDefaults(tx, ...)` /
   * `seedDefault(tx, ...)` / `seedDefaultSubscription(tx, ...)` methods,
   * all now threaded through the same `tx` — each module owns its own seed
   * step rather than CompanyService reaching into domains it doesn't own
   * (Phase 2 requirement #5: every module independent). Production/QC
   * seeding (ProductionStage, QcChecklistItem) is intentionally NOT added
   * here — see ProductionStagesService/QcChecklistService's own header
   * comments: the legacy system has no fixed default list for either,
   * unlike units/warehouse, so there's nothing to seed. `BillingService`
   * (Module 12) is the newest addition here — every company starts on the
   * free `starter` plan, `TRIALING` (Phase 0 billing stub).
   */
  async createCompany(dto: CreateCompanyDto) {
    const existingSlug = await this.prisma.company.findUnique({ where: { slug: dto.slug } });
    if (existingSlug) {
      throw new ConflictException('This slug is already taken.');
    }
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.ownerEmail } });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists.');
    }

    const passwordHash = await argon2.hash(dto.ownerPassword);
    const companyId = randomUUID();
    const ownerUserId = randomUUID();

    return this.prisma.runInTenantTransaction({ companyId, userId: ownerUserId }, async (tx) => {
      const company = await tx.company.create({
        data: {
          id: companyId,
          name: dto.companyName,
          slug: dto.slug,
          timezone: dto.timezone ?? 'Europe/Kyiv',
          locale: dto.locale ?? 'uk',
        },
      });

      const user = await tx.user.create({
        data: {
          id: ownerUserId,
          email: dto.ownerEmail,
          fullName: dto.ownerFullName,
          passwordHash,
        },
      });

      await this.rolesService.seedDefaultRoles(tx as any, company.id);

      const adminRole = await tx.role.findFirstOrThrow({
        where: { companyId: company.id, name: 'Admin' },
      });

      await tx.companyMembership.create({
        data: { companyId: company.id, userId: user.id, roleId: adminRole.id },
      });

      await tx.companySettings.create({
        data: { companyId: company.id },
      });

      await this.companyUnitsService.seedDefaults(tx as any, company.id);
      await this.warehousesService.seedDefault(tx as any, company.id);
      await this.billingService.seedDefaultSubscription(tx as any, company.id);

      return { company, ownerUserId: user.id };
    });
  }

  async findBySlug(slug: string) {
    return this.prisma.company.findUnique({ where: { slug } });
  }
}
