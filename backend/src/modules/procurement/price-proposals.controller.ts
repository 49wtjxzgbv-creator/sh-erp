import { Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PriceProposalsService } from './price-proposals.service';

/** "правка ціни щоб було тільки через підтвердження в основній erp" (2026-11-10) — review queue for price changes proposed from the Telegram Mini App. Same permission keys as supplier pricing generally (suppliers:read/write), not a new one. */
@ApiTags('procurement')
@Controller({ path: 'price-proposals', version: '1' })
export class PriceProposalsController {
  constructor(private readonly priceProposalsService: PriceProposalsService) {}

  @Get()
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Pending supplier-price proposals from the sourcing Mini App, newest first.' })
  async query(@CurrentUser() user: RequestUser) {
    return this.priceProposalsService.query(user);
  }

  @Patch(':id/approve')
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Approve a pending proposal — copies proposedPriceEur into ProductSupplier.price.' })
  async approve(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.priceProposalsService.approve(user, id);
  }

  @Patch(':id/reject')
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Reject a pending proposal — ProductSupplier.price is left untouched.' })
  async reject(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.priceProposalsService.reject(user, id);
  }
}
