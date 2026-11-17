import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

/** "Склад" (2026-11-02, extended 2026-11-18 — "готово те що ми зробили а відвантажено це з того що ми зробили") — supplierReadyQty is total qty made so far (capped at qtyOrdered - qtyReceived); supplierShippedQty is a SUBSET of that already dispatched (capped at supplierReadyQty, not independently). Both caps enforced by SupplierPortalService#updateSupplierStockQty, not here. */
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
