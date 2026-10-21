import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import {
  CreatePurchaseRequestDto,
  QueryPurchaseRequestsDto,
  SavePurchaseRequestItemsDto,
  UpdatePurchaseRequestDto,
} from './dto/purchase-request.dto';
import { PurchaseRequestsService } from './purchase-requests.service';

@ApiTags('procurement')
@Controller({ path: 'purchase-requests', version: '1' })
export class PurchaseRequestsController {
  constructor(private readonly purchaseRequestsService: PurchaseRequestsService) {}

  @Post()
  @RequirePermissions('purchase-requests:manage')
  @ApiOperation({ summary: 'Create a заявка на прорахунок (quote request) for one supplier — not yet a committed PurchaseOrder.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreatePurchaseRequestDto) {
    return this.purchaseRequestsService.create(user, dto);
  }

  @Get()
  @RequirePermissions('purchase-requests:read')
  @ApiOperation({ summary: 'Search/list purchase requests, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryPurchaseRequestsDto) {
    return this.purchaseRequestsService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('purchase-requests:read')
  @ApiOperation({ summary: 'Get one purchase request with its lines.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.purchaseRequestsService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('purchase-requests:manage')
  @ApiOperation({ summary: 'Update header fields (supplier, comment) — blocked once CONVERTED/CANCELLED.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdatePurchaseRequestDto) {
    return this.purchaseRequestsService.update(user, id, dto);
  }

  @Patch(':id/items')
  @RequirePermissions('purchase-requests:manage')
  @ApiOperation({ summary: 'Replace this request\'s line items in bulk — blocked once CONVERTED/CANCELLED.' })
  async saveItems(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SavePurchaseRequestItemsDto) {
    return this.purchaseRequestsService.saveItems(user, id, dto);
  }

  @Post(':id/send')
  @RequirePermissions('purchase-requests:manage')
  @ApiOperation({ summary: 'Mark as sent to the supplier — a status/timestamp marker only, editing stays allowed.' })
  async send(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.purchaseRequestsService.send(user, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('purchase-requests:manage')
  @ApiOperation({ summary: 'Cancel a DRAFT or SENT purchase request.' })
  async cancel(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.purchaseRequestsService.cancel(user, id);
  }

  @Post(':id/convert-to-order')
  @RequirePermissions('purchase-requests:manage')
  @ApiOperation({ summary: 'Create a real PurchaseOrder from this request\'s current items — blocked once already CONVERTED/CANCELLED.' })
  async convertToOrder(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.purchaseRequestsService.convertToOrder(user, id);
  }

  @Delete(':id')
  @RequirePermissions('purchase-requests:manage')
  @ApiOperation({ summary: 'Delete a DRAFT purchase request — use cancel() for a sent one.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.purchaseRequestsService.remove(user, id);
    return { ok: true };
  }
}
