import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { MonthlyProductionRollupQueryDto, ReorderSuggestionsQueryDto } from './dto/report-queries.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('reorder-suggestions')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Products whose (qty - reserved) is below 2× minQty, worst shortfall first (Phase 1 §3.6).' })
  async reorderSuggestions(@CurrentUser() user: RequestUser, @Query() query: ReorderSuggestionsQueryDto) {
    return this.reportsService.getReorderSuggestions(user, query);
  }

  @Get('warehouse-valuation')
  @RequirePermissions('reports:valuation')
  @ApiOperation({ summary: 'Stock valuation across all 5 legacy price fields, grouped by category — admin-only (Phase 1 §5).' })
  async warehouseValuation(@CurrentUser() user: RequestUser) {
    return this.reportsService.getWarehouseValuation(user);
  }

  @Get('monthly-production-rollup')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Completed production orders grouped by assembly over a date range (defaults to the current month).' })
  async monthlyProductionRollup(@CurrentUser() user: RequestUser, @Query() query: MonthlyProductionRollupQueryDto) {
    return this.reportsService.getMonthlyProductionRollup(user, query);
  }
}
