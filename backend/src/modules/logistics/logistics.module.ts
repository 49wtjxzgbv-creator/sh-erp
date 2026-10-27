import { Module } from '@nestjs/common';
import { TransportUnitTypesController } from './transport-unit-types.controller';
import { TransportUnitTypesService } from './transport-unit-types.service';

@Module({
  controllers: [TransportUnitTypesController],
  providers: [TransportUnitTypesService],
  exports: [TransportUnitTypesService],
})
export class LogisticsModule {}
