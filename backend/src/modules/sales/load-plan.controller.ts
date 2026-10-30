import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AddLoadPlanItemDto, GenerateLoadPlanDto, MoveLoadPlanItemDto, SetLoadPlanBoxPositionDto } from './dto/load-plan.dto';
import { LoadPlanService } from './load-plan.service';

@ApiTags('sales')
@Controller({ path: 'customer-orders/:customerOrderId/load-plan', version: '1' })
export class LoadPlanController {
  constructor(private readonly loadPlanService: LoadPlanService) {}

  @Post()
  @RequirePermissions('shipments:manage')
  @ApiOperation({ summary: 'Generate (or regenerate) the 3D load plan for this order\'s full ordered quantity.' })
  async generate(@CurrentUser() user: RequestUser, @Param('customerOrderId') customerOrderId: string, @Body() dto: GenerateLoadPlanDto) {
    return this.loadPlanService.generate(user, customerOrderId, dto.transportUnitTypeId);
  }

  @Get()
  @RequirePermissions('shipments:manage')
  @ApiOperation({ summary: 'Get the current load plan, with a freshly computed 3D layout per truck. Null if none generated yet.' })
  async get(@CurrentUser() user: RequestUser, @Param('customerOrderId') customerOrderId: string) {
    return this.loadPlanService.get(user, customerOrderId);
  }

  @Patch('items/:itemId')
  @RequirePermissions('shipments:manage')
  @ApiOperation({ summary: 'Manually move one load-plan line to a different truck.' })
  async moveItem(
    @CurrentUser() user: RequestUser,
    @Param('customerOrderId') customerOrderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: MoveLoadPlanItemDto,
  ) {
    return this.loadPlanService.moveItem(user, customerOrderId, itemId, dto.toTruckIndex);
  }

  @Post('items')
  @RequirePermissions('shipments:manage')
  @ApiOperation({ summary: 'Add an ad-hoc item to the plan — a real Assembly pick or a fully manual box, not derived from the order.' })
  async addItem(@CurrentUser() user: RequestUser, @Param('customerOrderId') customerOrderId: string, @Body() dto: AddLoadPlanItemDto) {
    return this.loadPlanService.addItem(user, customerOrderId, dto);
  }

  @Delete('items/:itemId')
  @RequirePermissions('shipments:manage')
  @ApiOperation({ summary: 'Remove an ad-hoc item from the plan. Order-derived lines cannot be removed here.' })
  async removeItem(@CurrentUser() user: RequestUser, @Param('customerOrderId') customerOrderId: string, @Param('itemId') itemId: string) {
    return this.loadPlanService.removeItem(user, customerOrderId, itemId);
  }

  @Put('items/:itemId/boxes/:boxIndex/position')
  @RequirePermissions('shipments:manage')
  @ApiOperation({ summary: 'Pin one specific box (dragged in the 3D view) to an exact position, pulling it out of the auto-packer.' })
  async setBoxPosition(
    @CurrentUser() user: RequestUser,
    @Param('customerOrderId') customerOrderId: string,
    @Param('itemId') itemId: string,
    @Param('boxIndex') boxIndex: string,
    @Body() dto: SetLoadPlanBoxPositionDto,
  ) {
    return this.loadPlanService.setBoxPosition(user, customerOrderId, itemId, Number(boxIndex), dto);
  }

  @Delete('items/:itemId/boxes/:boxIndex/position')
  @RequirePermissions('shipments:manage')
  @ApiOperation({ summary: 'Clear a manual position override — the box rejoins auto-packing.' })
  async clearBoxPosition(
    @CurrentUser() user: RequestUser,
    @Param('customerOrderId') customerOrderId: string,
    @Param('itemId') itemId: string,
    @Param('boxIndex') boxIndex: string,
  ) {
    return this.loadPlanService.clearBoxPosition(user, customerOrderId, itemId, Number(boxIndex));
  }
}
