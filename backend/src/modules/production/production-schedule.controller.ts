import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ProductionScheduleService } from './production-schedule.service';
import { QueryProductionScheduleDto } from './dto/production-schedule-slot.dto';

@ApiTags('production')
@Controller({ path: 'production-schedule', version: '1' })
export class ProductionScheduleController {
  constructor(private readonly scheduleService: ProductionScheduleService) {}

  @Get()
  @RequirePermissions('production-orders:read')
  @ApiOperation({ summary: 'Unified year-schedule view: real ProductionOrders + not-yet-converted planning slots. Defaults to the current calendar year.' })
  async getSchedule(@CurrentUser() user: RequestUser, @Query() query: QueryProductionScheduleDto) {
    return this.scheduleService.getSchedule(user, query);
  }
}
