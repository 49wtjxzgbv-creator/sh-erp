import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { AssembliesController } from './assemblies.controller';
import { AssembliesService } from './assemblies.service';

@Module({
  imports: [InventoryModule], // for StockService — produce() consumes components through the same ledger as every other stock mutation
  controllers: [AssembliesController],
  providers: [AssembliesService],
  exports: [AssembliesService],
})
export class BomModule {}
