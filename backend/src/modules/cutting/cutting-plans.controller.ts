import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CuttingPlansService } from './cutting-plans.service';
import { PreviewCuttingPlanDto } from './dto/preview-cutting-plan.dto';
import { UpsertProductCuttingSpecDto } from './dto/upsert-product-cutting-spec.dto';

@ApiTags('cutting')
@Controller({ path: 'cutting', version: '1' })
export class CuttingPlansController {
  constructor(private readonly cuttingPlansService: CuttingPlansService) {}

  @Get('specs/:productId')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'This product\'s cutting spec ("матеріал для розкрою"), if any — null when the product isn\'t cut-stock material.' })
  async getSpec(@CurrentUser() user: RequestUser, @Param('productId') productId: string) {
    return this.cuttingPlansService.getSpec(user, productId);
  }

  @Put('specs/:productId')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Create/update this product\'s cutting spec.' })
  async upsertSpec(@CurrentUser() user: RequestUser, @Param('productId') productId: string, @Body() dto: UpsertProductCuttingSpecDto) {
    return this.cuttingPlansService.upsertSpec(user, productId, dto);
  }

  @Delete('specs/:productId')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Turn off "матеріал для розкрою" for this product.' })
  async deleteSpec(@CurrentUser() user: RequestUser, @Param('productId') productId: string) {
    await this.cuttingPlansService.deleteSpec(user, productId);
  }

  @Post('preview')
  @RequirePermissions('cutting:write')
  @ApiOperation({ summary: 'Flatten an assembly\'s BOM into cut-stock demand, run the nesting optimizer, and persist a DRAFT CuttingPlan ("Порахувати розкрій").' })
  async preview(@CurrentUser() user: RequestUser, @Body() dto: PreviewCuttingPlanDto) {
    return this.cuttingPlansService.preview(user, dto);
  }

  @Post(':id/execute')
  @RequirePermissions('cutting:write')
  @ApiOperation({ summary: 'DRAFT -> EXECUTED: mark consumed remnants, create new leftover remnants ("Виконати розкрій"). Never touches WarehouseStock.qty.' })
  async execute(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.cuttingPlansService.execute(user, id);
  }

  @Get('remnants')
  @RequirePermissions('cutting:read')
  @ApiOperation({ summary: 'Available (AVAILABLE status) leftover offcuts, optionally filtered by product/warehouse ("Залишки розкрою").' })
  async listRemnants(@CurrentUser() user: RequestUser, @Query('productId') productId?: string, @Query('warehouseId') warehouseId?: string) {
    return this.cuttingPlansService.listRemnants(user, { productId, warehouseId });
  }

  @Get(':id')
  @RequirePermissions('cutting:read')
  @ApiOperation({ summary: 'A single cutting plan, grouped by raw material, with its full stock-item/cut breakdown.' })
  async getDetail(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.cuttingPlansService.getDetail(user, id);
  }
}
