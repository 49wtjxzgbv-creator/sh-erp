import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FinishedGoodsController } from './finished-goods.controller';
import { FinishedGoodsService } from './finished-goods.service';
import { ProductionExecutionsController } from './production-executions.controller';
import { ProductionExecutionsService } from './production-executions.service';
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
import { WorkTasksController } from './work-tasks.controller';
import { WorkTasksService } from './work-tasks.service';

@Module({
  imports: [InventoryModule, HrModule], // InventoryModule: StockService, for start()'s stock consumption. HrModule: PayrollPeriodsService, for ProductionExecutionsService's closed-period guard (locked spec #13)
  controllers: [
    ProductionStagesController,
    QcChecklistController,
    FinishedGoodsController,
    QcController,
    ProductionOrdersController,
    ProductionScheduleSlotsController,
    ProductionScheduleController,
    ProductionExecutionsController,
    WorkTasksController,
  ],
  providers: [
    ProductionStagesService,
    QcChecklistService,
    FinishedGoodsService,
    QcService,
    ProductionOrdersService,
    ProductionScheduleSlotsService,
    ProductionScheduleService,
    ProductionExecutionsService,
    WorkTasksService,
  ],
  exports: [
    ProductionStagesService,
    QcChecklistService,
    FinishedGoodsService,
    QcService,
    ProductionOrdersService,
    ProductionExecutionsService,
    WorkTasksService,
  ],
})
export class ProductionModule {}
