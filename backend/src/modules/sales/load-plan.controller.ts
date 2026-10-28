import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { GenerateLoadPlanDto, MoveLoadPlanItemDto } from './dto/load-plan.dto';
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
}
