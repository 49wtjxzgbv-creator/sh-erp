import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsObject, IsString, Min, MinLength } from 'class-validator';

export class UpsertPlanDto {
  @ApiProperty({ example: 'growth', description: 'Stable key — never change once companies are subscribed to it.' })
  @IsString()
  @MinLength(1)
  key!: string;

  @ApiProperty({ example: 'Growth' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 49 })
  @IsNumber()
  @Min(0)
  monthlyPriceEur!: number;

  @ApiProperty({
    example: { maxUsers: 15, maxProducts: 5000 },
    description: 'Deliberately flexible (Plan.limits is Json) — plan limits are inherently varied and non-relational.',
  })
  @IsObject()
  limits!: Record<string, unknown>;
}
