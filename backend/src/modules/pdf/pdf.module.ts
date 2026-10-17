import { Module } from '@nestjs/common';
import { PdfDocumentsController } from './pdf-documents.controller';
import { PdfDocumentsService } from './pdf-documents.service';

@Module({
  controllers: [PdfDocumentsController],
  providers: [PdfDocumentsService],
})
export class PdfModule {}
