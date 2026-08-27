import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateQuotationDto, QueryQuotationsDto, SaveQuotationItemsDto, UpdateQuotationVersionDto } from './dto/quotation.dto';
import { QuotationsService } from './quotations.service';

@ApiTags('quotations')
@Controller({ path: 'quotations', version: '1' })
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Post()
  @RequirePermissions('quotations:manage')
  @ApiOperation({ summary: 'Create a new quotation (version 1, DRAFT).' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateQuotationDto) {
    return this.quotationsService.create(user, dto);
  }

  @Get()
  @RequirePermissions('quotations:read')
  @ApiOperation({ summary: 'Search/list quotations, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryQuotationsDto) {
    return this.quotationsService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('quotations:read')
  @ApiOperation({ summary: 'Get one quotation with its current version, items, and version history.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.quotationsService.findOne(user, id);
  }

  @Get(':id/preview')
  @RequirePermissions('quotations:read')
  @ApiOperation({ summary: "Render the current version's document HTML — the exact same renderer send() uses for the PDF (§8)." })
  async previewHtml(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const html = await this.quotationsService.previewHtml(user, id);
    return { html };
  }

  @Patch(':id/terms')
  @RequirePermissions('quotations:manage')
  @ApiOperation({ summary: "Update the current (DRAFT) version's header terms — validUntil, currency, payment/delivery/installation terms, notes, template." })
  async updateTerms(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateQuotationVersionDto) {
    return this.quotationsService.updateVersionTerms(user, id, dto);
  }

  @Patch(':id/items')
  @RequirePermissions('quotations:manage')
  @ApiOperation({ summary: "Full replacement of the current (DRAFT) version's item list." })
  async saveItems(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SaveQuotationItemsDto) {
    return this.quotationsService.saveItems(user, id, dto);
  }

  @Post(':id/items/:itemId/approve-below-cost')
  @RequirePermissions('quotations:approve-below-cost')
  @ApiOperation({ summary: 'Explicitly approve a line priced below its cost snapshot — required before the quotation can be sent if any line is below cost.' })
  async approveBelowCost(@CurrentUser() user: RequestUser, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.quotationsService.approveBelowCost(user, id, itemId);
  }

  @Post(':id/send')
  @RequirePermissions('quotations:manage')
  @ApiOperation({ summary: 'Lock the current version, render and store its PDF, and mark the quotation SENT.' })
  async send(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.quotationsService.send(user, id);
  }

  @Post(':id/new-version')
  @RequirePermissions('quotations:manage')
  @ApiOperation({ summary: 'Start a new editable DRAFT version, copied from the current (locked) version.' })
  async createNewVersion(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.quotationsService.createNewVersion(user, id);
  }

  @Post(':id/duplicate')
  @RequirePermissions('quotations:manage')
  @ApiOperation({ summary: 'Create a brand-new quotation (new number/id/DRAFT) copied from this one.' })
  async duplicate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.quotationsService.duplicate(user, id);
  }

  @Post(':id/view')
  @RequirePermissions('quotations:read')
  @ApiOperation({ summary: 'Mark a SENT quotation as VIEWED — idempotent, intended for the client-facing view link.' })
  async markViewed(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.quotationsService.markViewed(user, id);
  }

  @Post(':id/accept')
  @RequirePermissions('quotations:manage')
  @ApiOperation({ summary: 'Mark the current version ACCEPTED.' })
  async accept(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.quotationsService.accept(user, id);
  }

  @Post(':id/reject')
  @RequirePermissions('quotations:manage')
  @ApiOperation({ summary: 'Mark the current version REJECTED.' })
  async reject(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.quotationsService.reject(user, id);
  }

  @Post(':id/convert-to-order')
  @RequirePermissions('quotations:convert')
  @ApiOperation({ summary: 'Convert an ACCEPTED quotation into a customer order, using the accepted version\'s frozen snapshot.' })
  async convertToOrder(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.quotationsService.convertToOrder(user, id);
  }
}
