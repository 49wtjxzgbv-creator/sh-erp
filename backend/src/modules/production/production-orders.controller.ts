import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import {
  CreateProductionOrderDto,
  QueryProductionOrdersDto,
  SetProductionOrderStagePlanDto,
  SetProductionOrderWorkersDto,
  StartProductionOrderDto,
} from './dto/production-order.dto';
import { ProductionOrdersService } from './production-orders.service';

@ApiTags('production')
@Controller({ path: 'production-orders', version: '1' })
export class ProductionOrdersController {
  constructor(private readonly productionOrdersService: ProductionOrdersService) {}

  @Post()
  @RequirePermissions('production-orders:manage')
  @ApiOperation({ summary: 'Create (reserve) a production order — locks in the assembly\'s current BOM version, does not touch stock.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateProductionOrderDto) {
    return this.productionOrdersService.create(user, dto);
  }

  @Get()
  @RequirePermissions('production-orders:read')
  @ApiOperation({ summary: 'Search/list production orders, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryProductionOrdersDto) {
    return this.productionOrdersService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('production-orders:read')
  @ApiOperation({ summary: 'Get one production order with its workers/pick-list/stage-history/finished-goods.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.productionOrdersService.findOne(user, id);
  }

  @Put(':id/workers')
  @RequirePermissions('production-orders:manage')
  @ApiOperation({ summary: 'Replace the assigned-worker list (PLANNED orders only).' })
  async setWorkers(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetProductionOrderWorkersDto,
  ) {
    return this.productionOrdersService.setWorkers(user, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('production-orders:manage')
  @ApiOperation({ summary: 'Cancel a PLANNED production order.' })
  async cancel(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.productionOrdersService.cancel(user, id);
  }

  @Delete(':id')
  @RequirePermissions('production-orders:delete')
  @ApiOperation({ summary: 'Permanently delete a production order — only PLANNED or CANCELLED (never one that has started, since start() already consumed stock/paid payroll/generated finished goods).' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.productionOrdersService.remove(user, id);
    return { ok: true };
  }

  @Post(':id/start')
  @RequirePermissions('production-orders:manage')
  @ApiOperation({
    summary:
      'Start the order: checks availability, physically consumes components (raw products from stock, ' +
      'sub-assemblies via FIFO-consumed FinishedGoods), generates serialized FinishedGoods, freezes cost, ' +
      'splits piecework pay, and enters stage tracking (or completes immediately if no stages are configured).',
  })
  async start(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: StartProductionOrderDto,
  ) {
    return this.productionOrdersService.start(user, id, dto);
  }

  @Post(':id/revert-start')
  @RequirePermissions('production-orders:delete')
  @ApiOperation({
    summary:
      'Undo start(): returns consumed raw-material stock and consumed sub-assembly finished goods, deletes this order\'s ' +
      'own output finished goods, reverses any recorded labor pay, and resets the order back to PLANNED. Only for ' +
      'IN_PROGRESS orders whose own output has not been shipped/QC-checked/consumed elsewhere yet.',
  })
  async revertStart(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.productionOrdersService.revertStart(user, id);
  }

  @Post(':id/advance-stage')
  @RequirePermissions('production-orders:manage')
  @ApiOperation({ summary: 'Advance to the next configured production stage; auto-completes on the last one.' })
  async advanceStage(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.productionOrdersService.advanceStage(user, id);
  }

  @Get(':id/stage-plan')
  @RequirePermissions('production-orders:read')
  @ApiOperation({ summary: 'Get this batch\'s per-stage plan (План-графік) — plan only, never the fact/history log.' })
  async getStagePlan(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.productionOrdersService.getStagePlan(user, id);
  }

  @Put(':id/stage-plan')
  @RequirePermissions('production-orders:manage')
  @ApiOperation({ summary: 'Replace this batch\'s per-stage plan. Stage names always come from this company\'s ProductionStage catalogue.' })
  async setStagePlan(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SetProductionOrderStagePlanDto) {
    return this.productionOrdersService.setStagePlan(user, id, dto);
  }
}
