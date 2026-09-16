import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SuperAdminGuard } from './super-admin-context';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminAuditService } from './super-admin-audit.service';
import { LoginSessionsAdminService } from './login-sessions-admin.service';

/** "Переглядати глобальні журнали" — three distinct logs, all cross-company. */
@ApiTags('super-admin')
@ApiBearerAuth()
@Public()
@UseGuards(SuperAdminGuard)
@Controller({ path: 'super-admin/audit', version: '1' })
export class AuditAdminController {
  constructor(
    private readonly prisma: SuperAdminPrismaService,
    private readonly superAdminAudit: SuperAdminAuditService,
    private readonly loginSessions: LoginSessionsAdminService,
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

  @Get('login-sessions')
  @ApiOperation({
    summary:
      '[Super Admin] "Хто заходить в програму" — real login events (not routine token-rotation noise) across ' +
      'every company, with IP/device/geolocation, built on RefreshToken.',
  })
  async loginSessionsList(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.loginSessions.list(limit ? Number(limit) : 50, offset ? Number(offset) : 0);
  }
}
