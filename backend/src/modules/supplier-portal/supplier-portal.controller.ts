import { Controller, Get, Param, Post, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSupplierPortalUser, RequestSupplierPortalUser, SupplierPortalGuard } from './supplier-portal-context';
import { SupplierPortalScopeInterceptor } from './supplier-portal-scope.interceptor';
import { SupplierPortalService } from './supplier-portal.service';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { DeliveryScheduleLinesDto } from '../procurement/dto/delivery-schedule.dto';

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
  constructor(private readonly supplierPortalService: SupplierPortalService) {}

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
}
