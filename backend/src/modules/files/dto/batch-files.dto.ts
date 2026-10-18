import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

/** Body for `POST /files/batch` — see BatchProductIdsDto's (catalog module) header comment for why this is POST+body, not GET+query. */
export class BatchFilesDto {
  @ApiProperty()
  @IsString()
  entityType!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  entityIds!: string[];

  @ApiPropertyOptional({ type: [String], description: 'Not validated against the FileDomain enum here — an unrecognized value just filters to zero rows rather than being unsafe (mirrors the old ?domain=a,b query param).' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  domain?: string[];
}
