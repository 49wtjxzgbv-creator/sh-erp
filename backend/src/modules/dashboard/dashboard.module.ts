import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardTimelineController } from './dashboard-timeline.controller';
import { DashboardTimelineService } from './dashboard-timeline.service';

@Module({
  controllers: [DashboardController, DashboardTimelineController],
  providers: [DashboardService, DashboardTimelineService],
})
export class DashboardModule {}
