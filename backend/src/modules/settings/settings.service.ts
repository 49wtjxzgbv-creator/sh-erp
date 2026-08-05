import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateCompanyBrandingDto } from './dto/update-branding.dto';
import { UpdateCompanySettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getSettings(user: RequestUser) {
    return this.prisma.tenant.companySettings.findUniqueOrThrow({
      where: { companyId: user.companyId },
    });
  }

  async updateSettings(user: RequestUser, dto: UpdateCompanySettingsDto) {
    const before = await this.getSettings(user);
    const settings = await this.prisma.tenant.companySettings.update({
      where: { companyId: user.companyId },
      data: dto as any,
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'company_settings.updated',
      entityType: 'CompanySettings',
      entityId: user.companyId,
      before,
      after: settings,
    });
    return settings;
  }

  async getBranding(user: RequestUser) {
    return this.prisma.tenant.companyBranding.findUnique({ where: { companyId: user.companyId } });
  }

  /** upsert — CompanyBranding is created empty at signup-adjacent time by BrandingModule's own seed step, but tolerate it not existing yet. */
  async updateBranding(user: RequestUser, dto: UpdateCompanyBrandingDto) {
    const branding = await this.prisma.tenant.companyBranding.upsert({
      where: { companyId: user.companyId },
      update: dto as any,
      create: { ...dto } as any,
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'company_branding.updated',
      entityType: 'CompanyBranding',
      entityId: user.companyId,
      after: branding,
    });
    return branding;
  }
}
