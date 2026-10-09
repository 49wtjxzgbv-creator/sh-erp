import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { StepConversionService } from './step-conversion.service';
import { GlbOptimizationService } from './glb-optimization.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, StepConversionService, GlbOptimizationService],
  exports: [FilesService],
})
export class FilesModule {}
