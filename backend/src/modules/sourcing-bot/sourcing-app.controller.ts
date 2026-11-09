import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TelegramWebAppAuthGuard } from './telegram-webapp-auth.guard';
import { CurrentSourcingIdentity } from './current-sourcing-identity.decorator';
import { ResolvedSourcingIdentity } from './sourcing-identity.service';
import { SourcingAppService } from './sourcing-app.service';
import { UpdateOutreachDto } from './dto/update-outreach.dto';

/**
 * HTTP API for the procurement sourcing Mini App (2026-11-10 — "веб версію
 * як застосунок"). Lives in the SAME process as the chat bot
 * (`SourcingBotService`) — see `main.ts`'s header comment for why this
 * process now also runs an HTTP listener — but is a fully separate route
 * tree, guarded end-to-end by `TelegramWebAppAuthGuard` (Telegram
 * `initData`, not a JWT/cookie — this process has no login flow).
 */
@ApiTags('sourcing-app')
@UseGuards(TelegramWebAppAuthGuard)
@Controller({ path: 'sourcing-app', version: '1' })
export class SourcingAppController {
  constructor(private readonly sourcingAppService: SourcingAppService) {}

  @Get('me')
  @ApiOperation({ summary: 'The paired identity for the current Telegram user — name shown in the Mini App header.' })
  async me(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity) {
    return { fullName: identity.fullName, isAdmin: identity.isAdmin };
  }

  @Get('categories')
  @ApiOperation({ summary: 'All sourcing categories with their tracked-product counts.' })
  async categories(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity) {
    return this.sourcingAppService.getCategories(identity);
  }

  @Get('categories/:id/products')
  @ApiOperation({ summary: 'Paginated, optionally article/name-filtered product list within one category.' })
  async categoryProducts(
    @CurrentSourcingIdentity() identity: ResolvedSourcingIdentity,
    @Param('id') categoryId: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.sourcingAppService.getCategoryProducts(identity, categoryId, search, Number(page ?? 0) || 0);
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Full product card: photo, our 5 price fields, real supplier prices, candidate suppliers for its category.' })
  async productDetail(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity, @Param('id') productId: string) {
    return this.sourcingAppService.getProductDetail(identity, productId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Cross-category article/name search among tracked products.' })
  async search(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity, @Query('q') q?: string) {
    const query = (q ?? '').trim();
    if (query.length < 2) return { items: [] };
    return this.sourcingAppService.search(identity, query);
  }

  @Get('suppliers')
  @ApiOperation({ summary: 'Every real, already-onboarded supplier linked to a tracked product, with their linked products.' })
  async suppliers(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity) {
    return this.sourcingAppService.getSuppliers(identity);
  }

  @Get('candidates')
  @ApiOperation({ summary: 'Candidate suppliers, optionally filtered by category/region, with current outreach status.' })
  async candidates(
    @CurrentSourcingIdentity() identity: ResolvedSourcingIdentity,
    @Query('categoryId') categoryId?: string,
    @Query('region') region?: string,
  ) {
    return this.sourcingAppService.getCandidates(identity, categoryId, region);
  }

  @Patch('candidates/:id/outreach')
  @ApiOperation({ summary: 'Update a candidate supplier\'s outreach status/note/quoted price — same writes as the bot\'s own setstatus/note/quote flows.' })
  async updateOutreach(
    @CurrentSourcingIdentity() identity: ResolvedSourcingIdentity,
    @Param('id') candidateId: string,
    @Body() dto: UpdateOutreachDto,
  ) {
    return this.sourcingAppService.updateOutreach(identity, candidateId, dto);
  }

  @Get('status')
  @ApiOperation({ summary: 'All candidates grouped by outreach status, with counts, for the dashboard tab.' })
  async status(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity) {
    return this.sourcingAppService.getStatusOverview(identity);
  }
}
