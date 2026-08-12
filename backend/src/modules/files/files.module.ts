import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { StepConversionService } from './step-conversion.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, StepConversionService],
  exports: [FilesService],
})
export class FilesModule {}
