import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { FinishedGoodsController } from './finished-goods.controller';
import { FinishedGoodsService } from './finished-goods.service';
import { ProductionOrdersController } from './production-orders.controller';
import { ProductionOrdersService } from './production-orders.service';
import { ProductionScheduleController } from './production-schedule.controller';
import { ProductionScheduleService } from './production-schedule.service';
import { ProductionScheduleSlotsController } from './production-schedule-slots.controller';
import { ProductionScheduleSlotsService } from './production-schedule-slots.service';
import { ProductionStagesController } from './production-stages.controller';
import { ProductionStagesService } from './production-stages.service';
import { QcChecklistController } from './qc-checklist.controller';
import { QcChecklistService } from './qc-checklist.service';
import { QcController } from './qc.controller';
import { QcService } from './qc.service';

@Module({
  imports: [InventoryModule], // for StockService — ProductionOrdersService.start() consumes raw-material components through the same ledger as every other stock mutation
  controllers: [
    ProductionStagesController,
    QcChecklistController,
    FinishedGoodsController,
    QcController,
    ProductionOrdersController,
    ProductionScheduleSlotsController,
    ProductionScheduleController,
  ],
  providers: [
    ProductionStagesService,
    QcChecklistService,
    FinishedGoodsService,
    QcService,
    ProductionOrdersService,
    ProductionScheduleSlotsService,
    ProductionScheduleService,
  ],
  exports: [ProductionStagesService, QcChecklistService, FinishedGoodsService, QcService, ProductionOrdersService],
})
export class ProductionModule {}
