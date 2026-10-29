import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ExchangeRatesService } from './exchange-rates.service';
import { QueryExchangeRateDto, QueryExchangeRatesDto, SetExchangeRateOverrideDto, SyncExchangeRatesDto } from './dto/exchange-rate.dto';

const DEFAULT_RANGE_DAYS = 90;

@ApiTags('exchange-rates')
@Controller({ path: 'exchange-rates', version: '1' })
export class ExchangeRatesController {
  constructor(private readonly exchangeRatesService: ExchangeRatesService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'NBU-sourced rates and this company\'s own manual overrides for a date range, newest first.' })
  async list(@Query() query: QueryExchangeRatesDto) {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
    return this.exchangeRatesService.listRates(from, to);
  }

  @Get('rate')
  @ApiOperation({
    summary:
      'Single resolved rate for one currency/date — used by print views (payroll, BOM specs) that need a real historical EUR->UAH rate instead of the old localStorage-only number. Intentionally no permission gate beyond authentication: payroll/BOM print is used by roles that may not hold any finance:* permission at all, and a currency rate is not sensitive data.',
  })
  async getRate(@CurrentUser() user: RequestUser, @Query() query: QueryExchangeRateDto) {
    return this.exchangeRatesService.getRate(user.companyId, query.currency, query.asOfDate);
  }

  @Post('override')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Manually correct the rate for one currency/date — takes priority over the NBU rate for that same date.' })
  async setOverride(@CurrentUser() user: RequestUser, @Body() dto: SetExchangeRateOverrideDto) {
    await this.exchangeRatesService.setOverride(user, dto.currency, dto.rate, dto.asOfDate);
    return { ok: true };
  }

  @Post('sync')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Fetch the latest rate(s) from NBU now, instead of waiting for the daily cron. `days` backfills further back than today.' })
  async sync(@Body() dto: SyncExchangeRatesDto) {
    await this.exchangeRatesService.syncRange(dto.days ?? 1);
    return { ok: true };
  }
}
