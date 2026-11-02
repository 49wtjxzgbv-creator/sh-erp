import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

/** "Склад" (2026-11-02) — the supplier's own declared qty already finished and sitting at their premises, not yet shipped. Capped at (qtyOrdered - qtyReceived) by SupplierPortalService#updateSupplierReadyQty, not here. */
export class UpdateSupplierReadyQtyDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  supplierReadyQty!: number;
}
