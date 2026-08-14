import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDate, IsOptional, ValidateIf } from 'class-validator';

// Same "'' from a bare <input type=date>, and an explicit null to clear a
// previously-set date, must both be handled — not just a real date string"
// concern as create-purchase-order's expectedDeliveryDate, but this is a
// correction UI (Склад's "Очікується від постачальника" tab) where clearing
// a field back to unset is a real, intended action, not a default-value
// omission — so '' and null both resolve to null (clear), a present key
// with a real date parses it, and an OMITTED key stays undefined
// (class-transformer only sets keys present in the request body), which
// PurchaseOrdersService#updateMilestones relies on to leave untouched
// fields untouched when passing the DTO straight to Prisma.
function toNullableDate({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return null;
  return new Date(value as string);
}

export class UpdatePurchaseOrderMilestonesDto {
  @ApiPropertyOptional({ nullable: true, description: 'Заплановано відправити заявку постачальнику.' })
  @IsOptional()
  @Transform(toNullableDate)
  @ValidateIf((_, value) => value !== null)
  @IsDate()
  plannedSendAt?: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'Дано постачальнику.' })
  @IsOptional()
  @Transform(toNullableDate)
  @ValidateIf((_, value) => value !== null)
  @IsDate()
  sentToSupplierAt?: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'Відвантажено постачальником.' })
  @IsOptional()
  @Transform(toNullableDate)
  @ValidateIf((_, value) => value !== null)
  @IsDate()
  shippedBySupplierAt?: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'Доставлено.' })
  @IsOptional()
  @Transform(toNullableDate)
  @ValidateIf((_, value) => value !== null)
  @IsDate()
  deliveredAt?: Date | null;
}
