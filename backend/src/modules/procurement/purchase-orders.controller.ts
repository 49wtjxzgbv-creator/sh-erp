import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreatePurchaseOrderDto, QueryPurchaseOrdersDto } from './dto/purchase-order.dto';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { UpdatePurchaseOrderMilestonesDto } from './dto/update-purchase-order-milestones.dto';
import { DeliveryScheduleLinesDto } from './dto/delivery-schedule.dto';
import { CreatePurchaseOrderCommentDto } from './dto/purchase-order-comment.dto';

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

  @Delete(':id')
  @RequirePermissions('purchase-orders:delete')
  @ApiOperation({ summary: 'Permanently delete a purchase order and its lines — admin-only, cannot be undone. Stock movements already posted against it (receiving) are untouched and keep their own record.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.purchaseOrdersService.remove(user, id);
    return { ok: true };
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

  @Patch(':id/milestones')
  @RequirePermissions('purchase-orders:manage')
  @ApiOperation({
    summary:
      'Correct the staff-tracked supplier-request timeline (planned send / sent / shipped-by-supplier / delivered) — Склад\'s "Очікується від постачальника" tab. Independent of status/qtyReceived.',
  })
  async updateMilestones(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderMilestonesDto,
  ) {
    return this.purchaseOrdersService.updateMilestones(user, id, dto);
  }

  @Post(':orderId/items/:itemId/delivery-schedule')
  @RequirePermissions('purchase-orders:manage')
  @ApiOperation({ summary: 'Create the first Delivery Schedule version for this item (Phase 1) — multi-date plan, additive to the existing order-level supplier confirmation.' })
  async createDeliverySchedule(
    @CurrentUser() user: RequestUser,
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: DeliveryScheduleLinesDto,
  ) {
    return this.purchaseOrdersService.createDeliverySchedule(user, orderId, itemId, dto);
  }

  @Post(':orderId/delivery-schedule/:scheduleId/accept')
  @RequirePermissions('purchase-orders:manage')
  @ApiOperation({ summary: "Accept a supplier's proposed delivery schedule — becomes the item's confirmed current version; the previous one is kept for history." })
  async acceptDeliverySchedule(@CurrentUser() user: RequestUser, @Param('orderId') orderId: string, @Param('scheduleId') scheduleId: string) {
    return this.purchaseOrdersService.acceptDeliverySchedule(user, orderId, scheduleId);
  }

  @Post(':orderId/delivery-schedule/:scheduleId/reject')
  @RequirePermissions('purchase-orders:manage')
  @ApiOperation({ summary: "Reject a supplier's proposed delivery schedule — the item's current version is left untouched." })
  async rejectDeliverySchedule(@CurrentUser() user: RequestUser, @Param('orderId') orderId: string, @Param('scheduleId') scheduleId: string) {
    return this.purchaseOrdersService.rejectDeliverySchedule(user, orderId, scheduleId);
  }

  @Get(':id/comments')
  @RequirePermissions('purchase-orders:read')
  @ApiOperation({ summary: 'Phase 2 — the discussion thread for this order (staff + supplier), oldest first.' })
  async listComments(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.purchaseOrdersService.listComments(user, id);
  }

  @Post(':id/comments')
  @RequirePermissions('purchase-orders:manage')
  @ApiOperation({ summary: 'Phase 2 — post a comment on this order, visible to the connected supplier.' })
  async addComment(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: CreatePurchaseOrderCommentDto) {
    return this.purchaseOrdersService.addComment(user, id, dto.body);
  }
}
