import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

/** Body for `POST /assemblies/batch` — see BatchProductIdsDto's header comment for why this is POST+body, not GET+query. */
export class BatchAssemblyIdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];
}
