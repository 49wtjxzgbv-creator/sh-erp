import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { QueryPlannerBoardDto } from './dto/planner-query.dto';
import { PlannerBoardService } from './planner-board.service';
import { PlannerKpisService } from './planner-kpis.service';

@ApiTags('planner')
@Controller({ path: 'planner', version: '1' })
export class PlannerController {
  constructor(
    private readonly boardService: PlannerBoardService,
    private readonly kpisService: PlannerKpisService,
  ) {}

  @Get('board')
  @RequirePermissions('planner:read')
  @ApiOperation({ summary: 'Full План-графік hierarchy: CustomerOrder → CustomerOrderItem → ProductionOrder batch → stage plan, plus purchase orders/problems.' })
  async getBoard(@CurrentUser() user: RequestUser, @Query() query: QueryPlannerBoardDto) {
    return this.boardService.getBoard(user, query);
  }

  @Get('kpis')
  @RequirePermissions('planner:read')
  @ApiOperation({ summary: 'Aggregate counts for the Planner KPI bar — derived from the same board data.' })
  async getKpis(@CurrentUser() user: RequestUser, @Query() query: QueryPlannerBoardDto) {
    return this.kpisService.getKpis(user, query);
  }
}
