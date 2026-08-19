import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

/** §2: the user's explicit split for one (order line × material) — never auto-decided. Both default to 0 so submitting one without the other is valid (e.g. "0 from stock, 20 to purchase"). */
export class SaveMaterialProvisioningDecisionDto {
  @ApiProperty({ description: 'How much of this material to reserve from existing physical stock for this order line.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qtyFromStock!: number;

  @ApiProperty({ description: 'How much of this material to newly purchase for this order line (informational cap checked at receiving time — see PurchaseOrdersService#receive).' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qtyToPurchase!: number;
}
