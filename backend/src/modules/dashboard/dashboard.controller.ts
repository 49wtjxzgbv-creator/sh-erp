import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

// Deliberately no @RequirePermissions here: this is the landing page every
// authenticated user sees regardless of role (Sales/Production/Storekeeper/
// Viewer/Admin alike), so gating it behind any one module's permission
// would 403 whichever roles don't hold that specific key.
@ApiTags('dashboard')
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Aggregate counts for the app landing page (products, low stock, open orders, ...).' })
  async getSummary(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getSummary(user);
  }
}
