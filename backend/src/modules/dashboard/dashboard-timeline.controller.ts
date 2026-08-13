import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { DashboardTimelineService } from './dashboard-timeline.service';
import { QueryOperationsTimelineDto } from './dto/operations-timeline.dto';

// Deliberately no @RequirePermissions — same reasoning as DashboardController:
// this is landing-page content every authenticated role sees, and it spans
// three modules' permission keys (procurement/production/sales), so gating
// on any single one would 403 roles missing just that one key.
@ApiTags('dashboard')
@Controller({ path: 'dashboard', version: '1' })
export class DashboardTimelineController {
  constructor(private readonly timelineService: DashboardTimelineService) {}

  @Get('operations-timeline')
  @ApiOperation({ summary: 'Unified year timeline across purchase orders, production orders, and shipments — for the landing-page Gantt chart. Defaults to the current calendar year.' })
  async getOperationsTimeline(@CurrentUser() user: RequestUser, @Query() query: QueryOperationsTimelineDto) {
    return this.timelineService.getOperationsTimeline(user, query);
  }
}
