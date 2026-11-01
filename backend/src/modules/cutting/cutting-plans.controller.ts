import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { StepBomExtractionService } from '../bom/step-bom-extraction.service';
import { CuttingPlansService } from './cutting-plans.service';
import { ExtractDefaultShapeDto } from './dto/extract-default-shape.dto';
import { PreviewCuttingPlanDto } from './dto/preview-cutting-plan.dto';
import { QueryCuttableProductsDto } from './dto/query-cuttable-products.dto';
import { UpsertProductCuttingSpecDto } from './dto/upsert-product-cutting-spec.dto';

@ApiTags('cutting')
@Controller({ path: 'cutting', version: '1' })
export class CuttingPlansController {
  constructor(
    private readonly cuttingPlansService: CuttingPlansService,
    private readonly stepBomExtractionService: StepBomExtractionService,
  ) {}

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

  @Post('specs/:productId/extract-default-shape')
  @RequirePermissions('products:write')
  @ApiOperation({
    summary:
      'Direct-product cutting (2026-11-01): STEP/3D CAD file (already uploaded as a FileAsset) → candidate piece shapes for this product\'s own default cut shape, read from the file\'s geometry (same extraction StepBomExtractionService already does for BOM lines, reused as-is). The caller picks one line and PUTs its lengthCm/widthCm/shapePolygon into specs/:productId.',
  })
  async extractDefaultShape(@CurrentUser() user: RequestUser, @Body() dto: ExtractDefaultShapeDto) {
    return this.stepBomExtractionService.extractComponentsFromStep(user, dto.fileAssetId);
  }

  @Post('extract-shape')
  @RequirePermissions('cutting:write')
  @ApiOperation({
    summary:
      'Ad-hoc multi-material worksheet (2026-11-01): STEP/3D CAD file → candidate piece shapes for a single worksheet position, with no product to hang the extraction off (same StepBomExtractionService logic as specs/:productId/extract-default-shape, at a param-less path).',
  })
  async extractShape(@CurrentUser() user: RequestUser, @Body() dto: ExtractDefaultShapeDto) {
    return this.stepBomExtractionService.extractComponentsFromStep(user, dto.fileAssetId);
  }

  @Get('products')
  @RequirePermissions('cutting:read')
  @ApiOperation({ summary: 'Every product with a ProductCuttingSpec configured, enriched with draft/executed CuttingPlan counts — the top-level "Розкрій" list page.' })
  async listCuttableProducts(@CurrentUser() user: RequestUser, @Query() query: QueryCuttableProductsDto) {
    return this.cuttingPlansService.listCuttableProducts(user, query);
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
