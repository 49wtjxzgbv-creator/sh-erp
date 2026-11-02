import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { CuttingPlansController } from './cutting-plans.controller';
import { CuttingPlansService } from './cutting-plans.service';
import { CadShapeExtractionService } from './cad-shape-extraction.service';
import { DxfExportService } from './dxf-export.service';

@Module({
  // FilesModule for FilesService/StepConversionService/DxfExtractionService
  // — CadShapeExtractionService's own STEP/DXF shape-upload dispatch
  // (2026-11-01).
  imports: [FilesModule],
  controllers: [CuttingPlansController],
  providers: [CuttingPlansService, CadShapeExtractionService, DxfExportService],
})
export class CuttingModule {}
