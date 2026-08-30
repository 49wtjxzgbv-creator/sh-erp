import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CustomerOrderShortageService } from './customer-order-shortage.service';
import { CustomerOrdersService } from './customer-orders.service';
import { CreateCustomerOrderDto, QueryCustomerOrdersDto, UpdateCustomerOrderDto } from './dto/customer-order.dto';
import { GiveItemToProductionDto, GiveSubAssemblyToProductionDto } from './dto/give-to-production.dto';
import { CreatePurchaseOrdersFromGroupsDto, SaveReservationDecisionsDto } from './dto/shortage-analysis.dto';

@ApiTags('sales')
@Controller({ path: 'customer-orders', version: '1' })
export class CustomerOrdersController {
  constructor(
    private readonly customerOrdersService: CustomerOrdersService,
    private readonly shortageService: CustomerOrderShortageService,
  ) {}

  @Post()
  @RequirePermissions('customer-orders:manage')
  @ApiOperation({ summary: 'Create a customer order (header + line items).' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateCustomerOrderDto) {
    return this.customerOrdersService.create(user, dto);
  }

  @Get()
  @RequirePermissions('customer-orders:read')
  @ApiOperation({ summary: 'Search/list customer orders, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryCustomerOrdersDto) {
    return this.customerOrdersService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('customer-orders:read')
  @ApiOperation({ summary: 'Get one customer order with its lines.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.customerOrdersService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('customer-orders:manage')
  @ApiOperation({ summary: 'Update order header fields — line items are immutable once created.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateCustomerOrderDto) {
    return this.customerOrdersService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('customer-orders:delete')
  @ApiOperation({ summary: 'Permanently delete a customer order and its lines — admin-only, cannot be undone (use cancel() for the reversible version).' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.customerOrdersService.remove(user, id);
    return { ok: true };
  }

  @Post(':id/cancel')
  @RequirePermissions('customer-orders:manage')
  @ApiOperation({ summary: 'Cancel a NEW or IN_PRODUCTION order.' })
  async cancel(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.customerOrdersService.cancel(user, id);
  }

  @Post(':id/complete')
  @RequirePermissions('customer-orders:manage')
  @ApiOperation({ summary: 'Mark the order COMPLETED (manual staff action).' })
  async complete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.customerOrdersService.complete(user, id);
  }

  @Post(':id/items/:itemId/give-to-production')
  @RequirePermissions('customer-orders:manage')
  @ApiOperation({ summary: 'Hand one order line off to production (reserves a ProductionOrder for it) — the staged/"poetapne" workflow (Phase 1 §6.2).' })
  async giveItemToProduction(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: GiveItemToProductionDto,
  ) {
    return this.customerOrdersService.giveItemToProduction(user, id, itemId, dto);
  }

  @Post(':id/items/:itemId/sub-assembly-batches')
  @RequirePermissions('customer-orders:manage')
  @ApiOperation({ summary: '"Хід виробництва" — hand a sub-assembly node (at any BOM depth under this item) off to production on demand.' })
  async giveSubAssemblyToProduction(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: GiveSubAssemblyToProductionDto,
  ) {
    return this.customerOrdersService.giveSubAssemblyToProduction(user, id, itemId, dto);
  }

  @Get(':id/items/:itemId/production-tree')
  @RequirePermissions('customer-orders:read')
  @ApiOperation({
    summary:
      '"Хід виробництва" — this line\'s full BOM tree (виріб -> підвироби -> their own підвироби), each node ' +
      'carrying its current IN_STOCK count, a done flag, and any already-planned ProductionOrder batches.',
  })
  async getItemProductionTree(@CurrentUser() user: RequestUser, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.customerOrdersService.getItemProductionTree(user, id, itemId);
  }

  @Get(':id/payroll-fund')
  @RequirePermissions('customer-orders:read')
  @ApiOperation({
    summary:
      '"Фонд заробітної плати на все замовлення" — estimated (live BOM rates, summed across every item\'s full ' +
      'production tree including sub-assemblies) vs actual (frozen laborCostEur, summed across every started batch).',
  })
  async getPayrollFundSummary(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.customerOrdersService.getPayrollFundSummary(user, id);
  }

  @Get(':id/production-units')
  @RequirePermissions('customer-orders:read')
  @ApiOperation({
    summary:
      '"В роботі" / "Що зроблено" for Виробництво → По замовленнях: every FinishedGood unit traceable to this ' +
      'order\'s production (any depth — top-level items AND sub-assembly batches), split by worker confirmation.',
  })
  async getOrderProductionUnits(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.customerOrdersService.getOrderProductionUnits(user, id);
  }

  @Post(':id/give-all-to-production')
  @RequirePermissions('customer-orders:manage')
  @ApiOperation({ summary: 'Hand every not-yet-given line off to production in one call.' })
  async giveAllToProduction(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.customerOrdersService.giveAllToProduction(user, id);
  }

  @Get(':id/shortage-preview')
  @RequirePermissions('customer-orders:manage')
  @ApiOperation({
    summary:
      'Recursive shortage analysis grouped by supplier (Phase 1 §6.3) — gross requirement only, current stock ' +
      'shown separately, never subtracted automatically ("no hidden arithmetic" rule).',
  })
  async shortagePreview(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.shortageService.previewShortage(user, id);
  }

  @Post(':id/purchase-orders-from-shortage')
  @RequirePermissions('customer-orders:manage')
  @ApiOperation({ summary: 'Commit the (possibly hand-edited) shortage preview — creates one PurchaseOrder per supplier group.' })
  async createPurchaseOrdersFromShortage(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreatePurchaseOrdersFromGroupsDto,
  ) {
    return this.shortageService.createPurchaseOrdersFromGroups(user, id, dto);
  }

  @Post(':id/reservations')
  @RequirePermissions('customer-orders:manage')
  @ApiOperation({ summary: '"Забронювати зі складу" — batch-adjust this order\'s stock-reserved qty for one or more products.' })
  async saveReservationDecisions(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SaveReservationDecisionsDto) {
    return this.shortageService.saveReservationDecisions(user, id, dto);
  }
}
