import { Module } from '@nestjs/common';
import { InventorySessionsController } from './inventory-sessions.controller';
import { InventorySessionsService } from './inventory-sessions.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { StockReservationService } from './stock-reservation.service';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

@Module({
  controllers: [WarehousesController, StockController, InventorySessionsController],
  providers: [WarehousesService, StockService, StockReservationService, InventorySessionsService],
  exports: [WarehousesService, StockService, StockReservationService, InventorySessionsService],
})
export class InventoryModule {}
