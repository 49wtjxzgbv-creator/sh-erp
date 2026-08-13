import { Injectable } from '@nestjs/common';
import { CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyUnitDto } from './dto/company-unit.dto';

/** Default units seeded per new company (Phase 3 §7, mirrors the old `seedUnitsIfEmpty_`). */
export const DEFAULT_COMPANY_UNITS = ['шт', 'уп', 'кг', 'м', 'рулон', 'комплект'];

@Injectable()
export class CompanyUnitsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Called from CompanyService at signup, inside its transaction — see ../tenancy/company.service.ts. */
  async seedDefaults(tx: Prisma.TransactionClient, companyId: string) {
    await tx.companyUnit.createMany({
      data: DEFAULT_COMPANY_UNITS.map((name) => ({ companyId, name })),
    });
  }

  async create(dto: CreateCompanyUnitDto) {
    try {
      return await this.prisma.tenant.companyUnit.create({ data: { name: dto.name } as any });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new CodedConflictException('COMPANY_UNIT_ALREADY_EXISTS', `Unit "${dto.name}" already exists.`);
      }
      throw err;
    }
  }

  async list() {
    return this.prisma.tenant.companyUnit.findMany({ orderBy: { name: 'asc' } });
  }

  /**
   * Rejects deletion if any product still references this unit (required FK,
   * decision 1 — a unit in use can never be safely removed, only renamed).
   */
  async remove(id: string) {
    const inUse = await this.prisma.tenant.product.count({ where: { unitId: id } });
    if (inUse > 0) {
      throw new CodedConflictException(
        'COMPANY_UNIT_IN_USE',
        `Cannot delete: ${inUse} product(s) still use this unit. Reassign them first.`,
      );
    }
    const unit = await this.prisma.tenant.companyUnit.findUnique({ where: { id } });
    if (!unit) throw new CodedNotFoundException('COMPANY_UNIT_NOT_FOUND', 'Unit not found.');
    await this.prisma.tenant.companyUnit.delete({ where: { id } });
    return { ok: true };
  }
}
