import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SuperAdminGuard } from './super-admin-context';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminAuditService } from './super-admin-audit.service';

/** "Переглядати глобальні журнали" — two distinct logs, both cross-company. */
@ApiTags('super-admin')
@ApiBearerAuth()
@Public()
@UseGuards(SuperAdminGuard)
@Controller({ path: 'super-admin/audit', version: '1' })
export class AuditAdminController {
  constructor(
    private readonly prisma: SuperAdminPrismaService,
    private readonly superAdminAudit: SuperAdminAuditService,
  ) {}

  @Get('events')
  @ApiOperation({ summary: '[Super Admin] Every tenant AuditEvent, across every company (not scoped to one).' })
  async events(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const take = limit ? Number(limit) : 50;
    const skip = offset ? Number(offset) : 0;
    const [items, total] = await Promise.all([
      this.prisma.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.auditEvent.count(),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  @Get('super-admin-actions')
  @ApiOperation({ summary: '[Super Admin] The Super Admin panel\'s own action log (who blocked/impersonated/etc, and when).' })
  async superAdminActions(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.superAdminAudit.query(limit ? Number(limit) : 50, offset ? Number(offset) : 0);
  }
}
