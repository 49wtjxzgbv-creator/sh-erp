import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { StepConversionService } from './step-conversion.service';
import { GlbOptimizationService } from './glb-optimization.service';
import { DxfExtractionService } from './dxf-extraction.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, StepConversionService, GlbOptimizationService, DxfExtractionService],
  exports: [FilesService, StepConversionService, DxfExtractionService],
})
export class FilesModule {}
