import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreatePurchaseOrderDto, QueryPurchaseOrdersDto } from './dto/purchase-order.dto';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';

@ApiTags('procurement')
@Controller({ path: 'purchase-orders', version: '1' })
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Post()
  @RequirePermissions('purchase-orders:manage')
  @ApiOperation({ summary: 'Create a multi-line purchase order.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrdersService.create(user, dto);
  }

  @Get()
  @RequirePermissions('purchase-orders:read')
  @ApiOperation({ summary: 'Search/list purchase orders, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryPurchaseOrdersDto) {
    return this.purchaseOrdersService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('purchase-orders:read')
  @ApiOperation({ summary: 'Get one purchase order with its lines.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.purchaseOrdersService.findOne(user, id);
  }

  @Post(':id/receive')
  @RequirePermissions('purchase-orders:manage')
  @ApiOperation({
    summary:
      'Record receiving against one or more lines — updates qtyReceived, posts RECEIVE stock movements for ' +
      'lines with a linked product, and recomputes the order\'s ORDERED/PARTIAL/DELIVERED status.',
  })
  async receive(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseOrderDto,
  ) {
    return this.purchaseOrdersService.receive(user, id, dto);
  }
}
