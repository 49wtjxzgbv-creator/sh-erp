import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MaxLength } from 'class-validator';

/** "нотатки до товару/постачальника — короткий текстовий комент, видимий усій команді" (2026-11-10). Note may be empty — that's how the frontend clears it (see SourcingAppService#upsertNote's own comment). */
export class UpsertNoteDto {
  @ApiProperty({ enum: ['Product', 'Supplier'] })
  @IsIn(['Product', 'Supplier'])
  entityType!: 'Product' | 'Supplier';

  @ApiProperty()
  @IsUUID()
  entityId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  note!: string;
}
