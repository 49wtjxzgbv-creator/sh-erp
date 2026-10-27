import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CodedBadRequestException } from '../../../common/api-exceptions';
import { CurrentUser, RequestUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { ApplyInvoiceStockImportDto } from './dto/invoice-stock-import.dto';
import { InvoiceStockImportService } from './invoice-stock-import.service';

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

@ApiTags('inventory')
@Controller({ path: 'stock/invoice-import', version: '1' })
export class InvoiceStockImportController {
  constructor(private readonly invoiceStockImportService: InvoiceStockImportService) {}

  @Post('preview')
  @RequirePermissions('stock:adjust')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Recognize {product, qty} rows from an uploaded supplier invoice PDF — a fast known-article-code parser ' +
      'first, falling back to AI (Gemini vision) recognition if nothing is found. Read-only — no DB writes; ' +
      'confirm via POST .../apply.',
  })
  async preview(@CurrentUser() user: RequestUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new CodedBadRequestException('IMPORT_NO_FILE_UPLOADED', 'No file uploaded (expected multipart field "file").');
    return this.invoiceStockImportService.preview(user, file.buffer, file.originalname, file.mimetype);
  }

  @Post('apply')
  @RequirePermissions('stock:adjust')
  @ApiOperation({ summary: 'Receive the confirmed rows from a prior .../preview call into the chosen warehouse (additive RECEIVE movements).' })
  async apply(@CurrentUser() user: RequestUser, @Body() dto: ApplyInvoiceStockImportDto) {
    return this.invoiceStockImportService.apply(user, dto);
  }
}
