import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreatePurchaseOrderDto, QueryPurchaseOrdersDto } from './dto/purchase-order.dto';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { UpdatePurchaseOrderMilestonesDto } from './dto/update-purchase-order-milestones.dto';
import { DeliveryScheduleLinesDto, BulkCreateDeliveryScheduleDto } from './dto/delivery-schedule.dto';
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

  @Post(':id/pdf')
  @RequirePermissions('purchase-orders:manage')
  @ApiOperation({ summary: 'Render and store a PDF of this order\'s current state (overwrites any previous one) — the document staff hand/email to the supplier.' })
  async generatePdf(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.purchaseOrdersService.generatePdf(user, id);
  }

  @Get(':id/batch')
  @RequirePermissions('purchase-orders:read')
  @ApiOperation({ summary: "Every sibling order fanned out from the same заявка conversion as this one (including itself), each with its own source customer order — \"приписка щоб розуміти з якого замовлення береться ця заявка\"." })
  async getBatch(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.purchaseOrdersService.getBatch(user, id);
  }

  @Post(':id/combined-pdf')
  @RequirePermissions('purchase-orders:manage')
  @ApiOperation({ summary: 'Render and store ONE combined PDF across every sibling order in this batch (overwrites any previous one) — "одним файлом" for the supplier, even though each customer order still keeps its own PurchaseOrder for Finance.' })
  async generateCombinedPdf(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.purchaseOrdersService.generateCombinedPdf(user, id);
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

  @Get('items/:itemId/delivery-schedule-siblings')
  @RequirePermissions('purchase-orders:read')
  @ApiOperation({ summary: 'Sibling PurchaseOrderItems fanned out from the same aggregated заявка line (across whichever customer orders they landed on) — empty array if this item has no siblings.' })
  async getDeliveryScheduleSiblings(@CurrentUser() user: RequestUser, @Param('itemId') itemId: string) {
    return this.purchaseOrdersService.getDeliveryScheduleSiblings(user, itemId);
  }

  @Post('delivery-schedules/bulk-create')
  @RequirePermissions('purchase-orders:manage')
  @ApiOperation({ summary: "Fill a delivery schedule once for a group of sibling items — splits each line's qty proportionally across them and creates each item's own first version." })
  async createGroupedDeliverySchedule(@CurrentUser() user: RequestUser, @Body() dto: BulkCreateDeliveryScheduleDto) {
    return this.purchaseOrdersService.createGroupedDeliverySchedule(user, dto);
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
