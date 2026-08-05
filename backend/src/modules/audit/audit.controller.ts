import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuditService } from './audit.service';
import { QueryAuditEventsDto } from './dto/query-audit-events.dto';

@ApiTags('audit')
@Controller({ path: 'audit-events', version: '1' })
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Query the audit trail, paginated and filterable.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryAuditEventsDto) {
    return this.auditService.query(user, query);
  }

  @Get('entity/:entityType/:entityId')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Full audit history for one entity, newest first.' })
  async forEntity(
    @CurrentUser() user: RequestUser,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.auditService.findForEntity(user, entityType, entityId);
  }
}
