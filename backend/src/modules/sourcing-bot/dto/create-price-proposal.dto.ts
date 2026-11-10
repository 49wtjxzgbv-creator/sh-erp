import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';

/** "правка ціни щоб було тільки через підтвердження в основній erp" (2026-11-10) — this only ever CREATES a pending proposal; it never writes ProductSupplier.price itself (see SourcingAppService#createPriceProposal's own comment). */
export class CreatePriceProposalDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  supplierId!: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  proposedPriceEur!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
