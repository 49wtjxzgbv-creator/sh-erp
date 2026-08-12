import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { BulkDeleteProductsDto } from './dto/bulk-delete-products.dto';
import { ProductsService } from './products.service';
import { ProductsImportExportService } from './import-export/products-import-export.service';

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — generous for a product catalog spreadsheet, small enough to hold entirely in memory (no disk write, see the service's own header comment)

@ApiTags('catalog')
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly importExportService: ProductsImportExportService,
  ) {}

  @Post()
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Create a product.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateProductDto) {
    return this.productsService.create(user, dto);
  }

  @Get()
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Search/list products, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryProductsDto) {
    return this.productsService.query(user, query);
  }

  /**
   * Declared BEFORE `GET /:id` — Nest matches routes in declaration order,
   * and `:id` would otherwise swallow the literal path segment "export".
   */
  @Get('export')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Export the full product catalog as an .xlsx workbook. Price columns are blank unless the caller also has reports:valuation (see ProductsImportExportService header comment).' })
  async export(@CurrentUser() user: RequestUser, @Res() res: Response) {
    const buffer = await this.importExportService.exportProducts(user);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="products-export.xlsx"',
    });
    res.send(buffer);
  }

  @Post('import')
  @RequirePermissions('products:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Bulk import/update products from an .xlsx file. Fuzzy multi-language header matching, upsert by article — ' +
      'see ProductsImportExportService header comment. `updateQuantities` defaults to false: a plain re-import ' +
      'only touches name/price/etc columns, never silently posts a stock ADJUST from a possibly-stale "Кількість" ' +
      'column (real incident: exporting then re-importing an unmodified file posted wrong ADJUST movements for ' +
      'every row, because the sheet\'s qty snapshot no longer matched live stock by the time it was re-imported).',
  })
  async import(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File,
    @Query('updateQuantities') updateQuantities?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded (expected multipart field "file").');
    return this.importExportService.importProducts(user, file.buffer, updateQuantities === 'true');
  }

  /**
   * Declared BEFORE `GET /:id` for the same reason as `export` above —
   * otherwise `:id` would swallow the literal path segment "batch".
   */
  @Get('batch')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Many products in one call by id — avoids an N-request fan-out resolving productIds into names/photos for a list view.' })
  async findByIds(@CurrentUser() user: RequestUser, @Query('ids') ids: string) {
    return this.productsService.findByIds(user, ids.split(',').filter(Boolean));
  }

  @Get(':id')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Get one product.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.productsService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Update a product.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Soft-delete a product.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.productsService.remove(user, id);
  }

  @Post('bulk-delete')
  @RequirePermissions('products:write')
  @ApiOperation({
    summary:
      'Soft-delete many products in one request — the Catalog table\'s "select all, delete selected" action. ' +
      'One request regardless of selection size, not N parallel DELETE calls (see ProductsService#bulkRemove).',
  })
  async bulkRemove(@CurrentUser() user: RequestUser, @Body() dto: BulkDeleteProductsDto) {
    return this.productsService.bulkRemove(user, dto.ids);
  }
}
