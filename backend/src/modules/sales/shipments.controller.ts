import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CalculateShipmentMetricsDto, CreateShipmentDto, QueryShipmentsDto } from './dto/shipment.dto';
import { ShipmentsService } from './shipments.service';

@ApiTags('sales')
@Controller({ path: 'shipments', version: '1' })
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Post()
  @RequirePermissions('shipments:manage')
  @ApiOperation({ summary: 'Create a shipment from one or more IN_STOCK finished goods — flips them to SHIPPED.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateShipmentDto) {
    return this.shipmentsService.create(user, dto);
  }

  @Post('calculate-metrics')
  @RequirePermissions('shipments:manage')
  @ApiOperation({ summary: 'Preview total weight, place count (boxes/pallets), volume, and suggested transport-unit counts for a set of finished goods — without creating a shipment.' })
  async calculateMetrics(@CurrentUser() user: RequestUser, @Body() dto: CalculateShipmentMetricsDto) {
    return this.shipmentsService.calculateMetrics(user, dto.finishedGoodIds);
  }

  @Get()
  @RequirePermissions('shipments:read')
  @ApiOperation({ summary: 'Search/list shipments, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryShipmentsDto) {
    return this.shipmentsService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('shipments:read')
  @ApiOperation({ summary: 'Get one shipment with its finished-good lines.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.shipmentsService.findOne(user, id);
  }

  @Post(':id/deliver')
  @RequirePermissions('shipments:manage')
  @ApiOperation({ summary: 'Mark a shipment delivered.' })
  async markDelivered(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.shipmentsService.markDelivered(user, id);
  }

  @Delete(':id')
  @RequirePermissions('shipments:manage')
  @ApiOperation({ summary: 'Delete a not-yet-delivered shipment — reverts its finished goods back to IN_STOCK.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.shipmentsService.remove(user, id);
  }
}
