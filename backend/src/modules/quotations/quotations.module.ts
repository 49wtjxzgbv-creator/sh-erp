import { Module } from '@nestjs/common';
import { BomModule } from '../bom/bom.module';
import { SalesModule } from '../sales/sales.module';
import { FilesModule } from '../files/files.module';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { QuotationTemplatesController } from './quotation-templates.controller';
import { QuotationTemplatesService } from './quotation-templates.service';
import { DocumentNumberingService } from './document-numbering.service';
import { QuotationPricingService } from './quotation-pricing.service';
import { QuotationPdfService } from './quotation-pdf.service';
import { QuotationRendererService } from './quotation-renderer.service';

@Module({
  imports: [BomModule, SalesModule, FilesModule], // BomModule: AssembliesService#calculateCost, read live at item-save time only. SalesModule: CustomerOrdersService, reused by convertToOrder. FilesModule: FilesService, for storing the rendered PDF and resolving a template's logo to a presigned URL.
  controllers: [QuotationsController, QuotationTemplatesController],
  providers: [QuotationsService, QuotationTemplatesService, DocumentNumberingService, QuotationPricingService, QuotationPdfService, QuotationRendererService],
  exports: [QuotationsService, QuotationTemplatesService, DocumentNumberingService, QuotationPricingService],
})
export class QuotationsModule {}
