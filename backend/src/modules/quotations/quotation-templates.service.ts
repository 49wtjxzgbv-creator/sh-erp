import { Injectable } from '@nestjs/common';
import { CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateQuotationTemplateDto, UpdateQuotationTemplateDto } from './dto/quotation-template.dto';

/**
 * Controlled design settings, not a page builder (§9 — "не треба робити
 * Canva"): a fixed field set (color/logo/header/footer/block visibility),
 * no free-form layout. A template's live row is only ever a POINTER — the
 * actual rendering config used by an already-SENT version is whatever got
 * copied into that version's own templateSnapshot at send() time
 * (QuotationsService#send), so editing or deleting a template here never
 * touches a document that already went out.
 */
@Injectable()
export class QuotationTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreateQuotationTemplateDto) {
    if (dto.isDefault) await this.clearExistingDefault(user);
    const template = await this.prisma.tenant.quotationTemplate.create({ data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation_template.created',
      entityType: 'QuotationTemplate',
      entityId: template.id,
      after: template,
    });
    return template;
  }

  async findOne(user: RequestUser, id: string) {
    const template = await this.prisma.tenant.quotationTemplate.findUnique({ where: { id } });
    if (!template || template.deletedAt) throw new CodedNotFoundException('QUOTATION_TEMPLATE_NOT_FOUND', 'Quotation template not found.');
    return template;
  }

  async query(user: RequestUser) {
    return this.prisma.tenant.quotationTemplate.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  async update(user: RequestUser, id: string, dto: UpdateQuotationTemplateDto) {
    const before = await this.findOne(user, id);
    if (dto.isDefault) await this.clearExistingDefault(user, id);
    const template = await this.prisma.tenant.quotationTemplate.update({ where: { id }, data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation_template.updated',
      entityType: 'QuotationTemplate',
      entityId: id,
      before,
      after: template,
    });
    return template;
  }

  async remove(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    if (before.deletedAt) throw new CodedConflictException('QUOTATION_TEMPLATE_ALREADY_DELETED', 'Quotation template is already deleted.');
    const template = await this.prisma.tenant.quotationTemplate.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation_template.deleted',
      entityType: 'QuotationTemplate',
      entityId: id,
      before,
    });
    return template;
  }

  private async clearExistingDefault(user: RequestUser, excludeId?: string) {
    const current = await this.prisma.tenant.quotationTemplate.findFirst({ where: { isDefault: true, deletedAt: null } });
    if (current && current.id !== excludeId) {
      await this.prisma.tenant.quotationTemplate.update({ where: { id: current.id }, data: { isDefault: false } });
    }
  }
}
