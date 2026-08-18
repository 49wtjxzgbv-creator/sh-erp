import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

export class AssemblySupplierLineDto {
  @ApiProperty()
  @IsUUID()
  supplierId!: string;

  @ApiPropertyOptional({ description: 'This supplier\'s price for this assembly — informational, not automatically pulled into any purchase order line.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Display/pre-selection hint only — never bypasses the "ask which supplier" prompt in the shortage engine when an assembly has more than one linked supplier.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class SetAssemblySuppliersDto {
  @ApiProperty({
    type: [AssemblySupplierLineDto],
    description: 'The full linked-supplier list for this assembly. Replaces every existing row — there is no partial-update endpoint, same convention as SetAssemblyComponentsDto.',
  })
  @IsArray()
  @ArrayUnique((line: AssemblySupplierLineDto) => line.supplierId)
  @ValidateNested({ each: true })
  @Type(() => AssemblySupplierLineDto)
  suppliers!: AssemblySupplierLineDto[];
}
