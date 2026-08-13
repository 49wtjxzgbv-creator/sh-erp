import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSupplierPortalUser, RequestSupplierPortalUser, SupplierPortalGuard } from './supplier-portal-context';
import { SupplierPortalScopeInterceptor } from './supplier-portal-scope.interceptor';
import { SupplierPortalService } from './supplier-portal.service';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';

/**
 * Everything a logged-in supplier can reach. `SupplierPortalGuard` verifies
 * the token and sets `request.supplierPortalUser`; `SupplierPortalScopeInterceptor`
 * (runs after, per Nest's guards-then-interceptors order) reads that to
 * open the RLS-scoped transaction. Neither is `@Public()` — this is the
 * "real" side of the portal, unlike the login route.
 */
@ApiTags('supplier-portal')
@Controller({ path: 'supplier-portal', version: '1' })
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
}
