import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TelegramWebAppAuthGuard } from './telegram-webapp-auth.guard';
import { CurrentSourcingIdentity } from './current-sourcing-identity.decorator';
import { ResolvedSourcingIdentity } from './sourcing-identity.service';
import { SourcingAppService } from './sourcing-app.service';
import { UpdateOutreachDto } from './dto/update-outreach.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { TranslateNameDto } from './dto/translate-name.dto';
import { UpsertNoteDto } from './dto/upsert-note.dto';
import { CreatePriceProposalDto } from './dto/create-price-proposal.dto';
import { SendOutreachLetterDto } from './dto/send-outreach-letter.dto';
import { GenerateOutreachLetterDto } from './dto/generate-outreach-letter.dto';

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
    @Query('filter') filter?: string,
  ) {
    return this.sourcingAppService.getCategoryProducts(identity, categoryId, search, Number(page ?? 0) || 0, filter);
  }

  @Get('assemblies')
  @ApiOperation({ summary: 'Every "виріб"/специфікація (Assembly) this company manufactures, with its direct BOM-line count.' })
  async assemblies(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity) {
    return this.sourcingAppService.getAssemblies(identity);
  }

  @Get('assemblies/:id/products')
  @ApiOperation({ summary: 'Every real Product anywhere in this assembly\'s BOM tree (recursively flattened through sub-assemblies), paginated.' })
  async assemblyProducts(
    @CurrentSourcingIdentity() identity: ResolvedSourcingIdentity,
    @Param('id') assemblyId: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('filter') filter?: string,
  ) {
    return this.sourcingAppService.getAssemblyProducts(identity, assemblyId, search, Number(page ?? 0) || 0, filter);
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Full product card: photo, our 5 price fields, real supplier prices, candidate suppliers for its category.' })
  async productDetail(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity, @Param('id') productId: string) {
    return this.sourcingAppService.getProductDetail(identity, productId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Cross-category article/name search among tracked products.' })
  async search(
    @CurrentSourcingIdentity() identity: ResolvedSourcingIdentity,
    @Query('q') q?: string,
    @Query('filter') filter?: string,
  ) {
    const query = (q ?? '').trim();
    if (query.length < 2) return { items: [] };
    return this.sourcingAppService.search(identity, query, filter);
  }

  @Get('suppliers')
  @ApiOperation({ summary: 'Paginated, every real, already-onboarded supplier linked to a tracked product, with their linked products.' })
  async suppliers(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity, @Query('page') page?: string) {
    return this.sourcingAppService.getSuppliers(identity, Number(page ?? 0) || 0);
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

  @Post('candidates')
  @ApiOperation({ summary: 'Add a new candidate supplier (procurement-admin only) — same shape as the bot\'s own admin-only ➕ Додати постачальника flow.' })
  async createCandidate(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity, @Body() dto: CreateCandidateDto) {
    return this.sourcingAppService.createCandidate(identity, dto);
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

  @Post('translate')
  @ApiOperation({ summary: 'On-demand translate a product name to Ukrainian via the platform Gemini key — "додай можливість перекладу назв товарів на українську".' })
  async translate(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity, @Body() dto: TranslateNameDto) {
    return this.sourcingAppService.translateName(identity, dto.text);
  }

  @Get('status')
  @ApiOperation({ summary: 'All candidates grouped by outreach status, with counts, for the dashboard tab.' })
  async status(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity) {
    return this.sourcingAppService.getStatusOverview(identity);
  }

  @Patch('notes')
  @ApiOperation({ summary: 'Set (or, with an empty note, clear) the team-shared note on a product or real supplier — "нотатки до товару/постачальника... видимий усій команді".' })
  async upsertNote(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity, @Body() dto: UpsertNoteDto) {
    return this.sourcingAppService.upsertNote(identity, dto.entityType, dto.entityId, dto.note);
  }

  @Post('price-proposals')
  @ApiOperation({ summary: 'Propose a new price for a real supplier\'s product (procurement-admin only) — never writes ProductSupplier.price directly; a human confirms in the main ERP.' })
  async createPriceProposal(@CurrentSourcingIdentity() identity: ResolvedSourcingIdentity, @Body() dto: CreatePriceProposalDto) {
    return this.sourcingAppService.createPriceProposal(identity, dto.productId, dto.supplierId, dto.proposedPriceEur, dto.note);
  }

  @Post('candidates/:id/outreach-letter')
  @ApiOperation({ summary: 'Generate an AI outreach-letter text + a PDF (photo/article/name) of every product in the candidate\'s own category (procurement-admin only) — "сформувати лист".' })
  async generateOutreachLetter(
    @CurrentSourcingIdentity() identity: ResolvedSourcingIdentity,
    @Param('id') candidateId: string,
    @Body() dto: GenerateOutreachLetterDto,
  ) {
    return this.sourcingAppService.generateOutreachLetter(identity, candidateId, dto.fromName);
  }

  @Post('candidates/:id/outreach-letter/send')
  @ApiOperation({ summary: 'Email the reviewed outreach-letter text with a freshly-regenerated PDF attached (procurement-admin only).' })
  async sendOutreachLetter(
    @CurrentSourcingIdentity() identity: ResolvedSourcingIdentity,
    @Param('id') candidateId: string,
    @Body() dto: SendOutreachLetterDto,
  ) {
    return this.sourcingAppService.sendOutreachLetterEmail(identity, candidateId, dto.text, dto.fromName);
  }
}
