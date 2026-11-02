import { Controller, Get, Param, Patch, Post, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSupplierPortalUser, RequestSupplierPortalUser, SupplierPortalGuard } from './supplier-portal-context';
import { SupplierPortalScopeInterceptor } from './supplier-portal-scope.interceptor';
import { SupplierPortalService } from './supplier-portal.service';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { DeliveryScheduleLinesDto } from '../procurement/dto/delivery-schedule.dto';
import { CreatePurchaseOrderCommentDto } from '../procurement/dto/purchase-order-comment.dto';
import { SupplierPortalUploadDto } from './dto/supplier-portal-upload.dto';
import { QuotePurchaseRequestDto } from './dto/quote-purchase-request.dto';
import { UpdateSupplierCatalogEntryDto } from './dto/update-supplier-catalog-entry.dto';
import { UpdateSupplierReadyQtyDto } from './dto/update-supplier-ready-qty.dto';
import { PreviewSupplierCuttingDto } from './dto/preview-supplier-cutting.dto';
import { SupplierCuttingService } from './supplier-cutting.service';

/**
 * Everything a logged-in supplier can reach. `@Public()` here means "skip
 * the regular JwtAuthGuard/TenantScopeInterceptor pipeline" (that global
 * guard 401s any non-`@Public()` route whose `req.user` isn't set by
 * `TenantContextMiddleware` — which never happens for a supplier-portal
 * token, verified with a different secret entirely) — same pattern every
 * SuperAdmin data controller uses (see e.g. companies-admin.controller.ts).
 * It is NOT actually open to the public: `SupplierPortalGuard` (own JWT
 * verification, sets `request.supplierPortalUser`) is the real gate, and
 * `SupplierPortalScopeInterceptor` (runs after, per Nest's
 * guards-then-interceptors order) reads that to open the RLS-scoped
 * transaction.
 */
@ApiTags('supplier-portal')
@Controller({ path: 'supplier-portal', version: '1' })
@Public()
@UseGuards(SupplierPortalGuard)
@UseInterceptors(SupplierPortalScopeInterceptor)
export class SupplierPortalController {
  constructor(
    private readonly supplierPortalService: SupplierPortalService,
    private readonly supplierCuttingService: SupplierCuttingService,
  ) {}

  @Get('purchase-orders')
  @ApiOperation({ summary: "This supplier's own purchase orders — never any other supplier's." })
  async listPurchaseOrders(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser) {
    return this.supplierPortalService.listPurchaseOrders(actor);
  }

  @Get('purchase-orders/:id')
  @ApiOperation({ summary: "One of this supplier's own purchase orders. 404s (not 403s) for anyone else's — never confirms an id belongs to another supplier." })
  async getPurchaseOrder(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser, @Param('id') id: string) {
    return this.supplierPortalService.getPurchaseOrder(actor, id);
  }

  @Post('purchase-orders/:id/confirm')
  @ApiOperation({ summary: 'Supplier confirms price per line and/or a delivery date — informational fields, never overwrite internal staff’s own expectedPrice/actualPrice/expectedDeliveryDate.' })
  async confirmPurchaseOrder(
    @CurrentSupplierPortalUser() actor: RequestSupplierPortalUser,
    @Param('id') id: string,
    @Body() dto: ConfirmPurchaseOrderDto,
  ) {
    return this.supplierPortalService.confirmPurchaseOrder(actor, id, dto);
  }

  @Post('purchase-orders/:orderId/delivery-schedule/:scheduleId/confirm')
  @ApiOperation({ summary: 'Confirm this delivery schedule as-is (Phase 1) — no split, accept the requested dates/quantities.' })
  async confirmDeliverySchedule(
    @CurrentSupplierPortalUser() actor: RequestSupplierPortalUser,
    @Param('orderId') orderId: string,
    @Param('scheduleId') scheduleId: string,
  ) {
    return this.supplierPortalService.confirmDeliverySchedule(actor, orderId, scheduleId);
  }

  @Post('purchase-orders/:orderId/delivery-schedule/:scheduleId/propose')
  @ApiOperation({ summary: 'Propose a different split for this delivery schedule (Phase 1) — creates a new version awaiting the manufacturer\'s decision; the current schedule stays in effect until then.' })
  async proposeDeliverySchedule(
    @CurrentSupplierPortalUser() actor: RequestSupplierPortalUser,
    @Param('orderId') orderId: string,
    @Param('scheduleId') scheduleId: string,
    @Body() dto: DeliveryScheduleLinesDto,
  ) {
    return this.supplierPortalService.proposeDeliverySchedule(actor, orderId, scheduleId, dto);
  }

  @Get('purchase-orders/:id/comments')
  @ApiOperation({ summary: 'Phase 2 — the discussion thread for this order (staff + supplier), oldest first.' })
  async listComments(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser, @Param('id') id: string) {
    return this.supplierPortalService.listComments(actor, id);
  }

  @Post('purchase-orders/:id/comments')
  @ApiOperation({ summary: 'Phase 2 — post a comment on this order, visible to the manufacturer.' })
  async addComment(
    @CurrentSupplierPortalUser() actor: RequestSupplierPortalUser,
    @Param('id') id: string,
    @Body() dto: CreatePurchaseOrderCommentDto,
  ) {
    return this.supplierPortalService.addComment(actor, id, dto.body);
  }

  @Get('purchase-orders/:id/files')
  @ApiOperation({ summary: 'Phase 2 — documents (e.g. invoices) attached to this order, staff- and supplier-uploaded alike.' })
  async listFiles(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser, @Param('id') id: string) {
    return this.supplierPortalService.listFiles(actor, id);
  }

  @Post('purchase-orders/:id/files/presigned-upload')
  @ApiOperation({ summary: 'Phase 2, step 1 of 2: get a presigned PUT URL to attach a document to this order.' })
  async createFileUpload(
    @CurrentSupplierPortalUser() actor: RequestSupplierPortalUser,
    @Param('id') id: string,
    @Body() dto: SupplierPortalUploadDto,
  ) {
    return this.supplierPortalService.createFileUpload(actor, id, dto);
  }

  @Post('purchase-orders/:id/files/:fileId/confirm')
  @ApiOperation({ summary: 'Phase 2, step 2 of 2: confirm the direct-to-R2 upload succeeded.' })
  async confirmFileUpload(
    @CurrentSupplierPortalUser() actor: RequestSupplierPortalUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.supplierPortalService.confirmFileUpload(actor, id, fileId);
  }

  @Get('purchase-orders/:id/files/:fileId/download-url')
  @ApiOperation({ summary: 'Phase 2 — short-lived presigned GET URL for a document attached to this order.' })
  async getFileDownloadUrl(
    @CurrentSupplierPortalUser() actor: RequestSupplierPortalUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.supplierPortalService.getFileDownloadUrl(actor, id, fileId);
  }

  @Get('purchase-requests')
  @ApiOperation({ summary: "This supplier's own purchase requests (заявки на прорахунок) — DRAFT ones excluded, staff hasn't sent those yet." })
  async listPurchaseRequests(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser) {
    return this.supplierPortalService.listPurchaseRequests(actor);
  }

  @Get('purchase-requests/:id')
  @ApiOperation({ summary: "One of this supplier's own purchase requests. 404s (not 403s) for anyone else's, or a DRAFT one." })
  async getPurchaseRequest(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser, @Param('id') id: string) {
    return this.supplierPortalService.getPurchaseRequest(actor, id);
  }

  @Post('purchase-requests/:id/quote')
  @ApiOperation({ summary: 'Supplier submits (or re-submits) a per-line quoted price. Only while the request is SENT.' })
  async quotePurchaseRequest(
    @CurrentSupplierPortalUser() actor: RequestSupplierPortalUser,
    @Param('id') id: string,
    @Body() dto: QuotePurchaseRequestDto,
  ) {
    return this.supplierPortalService.quotePurchaseRequest(actor, id, dto);
  }

  @Get('catalog')
  @ApiOperation({ summary: "Every product ever sent to this supplier via a purchase order or sent purchase request — accumulates automatically, never any other supplier's." })
  async listCatalog(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser) {
    return this.supplierPortalService.listCatalog(actor);
  }

  @Get('catalog/:id')
  @ApiOperation({ summary: "One catalog entry. 404s (not 403s) for anyone else's." })
  async getCatalogEntry(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser, @Param('id') id: string) {
    return this.supplierPortalService.getCatalogEntry(actor, id);
  }

  @Patch('catalog/:id')
  @ApiOperation({ summary: "Supplier edits their own cost note and/or the price they'll sell this to us — never the company's own staff-managed price." })
  async updateCatalogEntry(
    @CurrentSupplierPortalUser() actor: RequestSupplierPortalUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierCatalogEntryDto,
  ) {
    return this.supplierPortalService.updateCatalogEntry(actor, id, dto);
  }

  @Get('dashboard-summary')
  @ApiOperation({ summary: 'Counts for the portal dashboard — active orders, quotes awaiting a price, catalog size, upcoming/overdue delivery obligations.' })
  async getDashboardSummary(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser) {
    return this.supplierPortalService.getDashboardSummary(actor);
  }

  @Get('deliveries')
  @ApiOperation({ summary: '"План виробництва" — every upcoming delivery obligation across all open orders, flattened and sorted soonest-first.' })
  async listUpcomingDeliveries(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser) {
    return this.supplierPortalService.listUpcomingDeliveries(actor);
  }

  @Get('stock')
  @ApiOperation({ summary: '"Склад" — every still-outstanding open order line, with the supplier\'s own declared ready-not-shipped qty.' })
  async listStock(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser) {
    return this.supplierPortalService.listStock(actor);
  }

  @Patch('stock/:itemId')
  @ApiOperation({ summary: 'Supplier declares how much of this line is already finished and sitting at their own premises — capped at what is still outstanding.' })
  async updateSupplierReadyQty(
    @CurrentSupplierPortalUser() actor: RequestSupplierPortalUser,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateSupplierReadyQtyDto,
  ) {
    return this.supplierPortalService.updateSupplierReadyQty(actor, itemId, dto);
  }

  @Post('cutting/preview')
  @ApiOperation({
    summary:
      '"Розкрій" — supplier-run nesting on the supplier\'s own sheet/bar material. Fully stateless: nothing is read from or written to our own data, only the optimizer + DXF writer run against the request body.',
  })
  async previewCutting(@Body() dto: PreviewSupplierCuttingDto) {
    return this.supplierCuttingService.preview(dto);
  }
}
