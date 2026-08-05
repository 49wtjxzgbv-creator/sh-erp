import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { LowStockDigestService } from './low-stock-digest.service';

/**
 * Gated behind `settings:manage` — same permission as the
 * `dailyDigestEnabled`/`dailyDigestEmail` fields these routes act on
 * (Module 3's `SettingsService`), matching the legacy
 * `requireRole_(token, ['admin'])` on every `Automation.gs` endpoint.
 */
@ApiTags('notifications')
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly lowStockDigestService: LowStockDigestService) {}

  @Get('low-stock-digest/preview')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: "Preview today's low-stock digest content without sending it." })
  async preview() {
    return this.lowStockDigestService.buildDigestContent();
  }

  @Post('low-stock-digest/send-now')
  @RequirePermissions('settings:manage')
  @ApiOperation({
    summary:
      'Send the low-stock digest immediately (on-demand — no automatic daily schedule is wired up yet in this sandbox build; see LowStockDigestService\'s header comment).',
  })
  async sendNow(@CurrentUser() user: RequestUser) {
    return this.lowStockDigestService.sendDigestForCompany(user);
  }
}
