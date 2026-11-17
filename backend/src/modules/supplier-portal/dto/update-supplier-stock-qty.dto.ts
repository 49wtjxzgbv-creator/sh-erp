import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

/** "Склад" (2026-11-02, extended 2026-11-17 — "де я маю вказувати що відвантажив") — the supplier's own declared qty already finished-and-not-shipped, plus already-dispatched-and-in-transit. Both capped together at (qtyOrdered - qtyReceived) by SupplierPortalService#updateSupplierStockQty, not here. */
export class UpdateSupplierStockQtyDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  supplierReadyQty!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  supplierShippedQty!: number;
}
