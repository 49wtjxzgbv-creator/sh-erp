import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsUUID } from 'class-validator';

/**
 * Body for `POST /products/batch` — was `GET ?ids=a,b,c` until the id list
 * itself grew long enough (a few hundred UUIDs, ~12KB+) to blow past
 * Node's default header-size limit once combined with the Authorization
 * header, silently killing the connection before any application code or
 * access log ever saw the request (real incident: Склад/Каталог showing
 * blank photo/name/article for a company with enough products). A POST
 * body has no comparable practical ceiling.
 */
export class BatchProductIdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];
}

/** Same rationale as BatchProductIdsDto, keyed by article string instead. */
export class BatchProductArticlesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  articles!: string[];
}
