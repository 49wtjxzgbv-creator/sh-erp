import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

/** Mirrors files/dto/create-presigned-upload.dto.ts, minus domain/entityType/entityId — landing media is global, not attached to a tenant entity. */
export class CreateLandingMediaUploadDto {
  @ApiProperty({ example: 'hero-screenshot.png' })
  @IsString()
  @MaxLength(255)
  originalName!: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  @MaxLength(127)
  mimeType!: string;

  @ApiProperty({ example: 245_760, description: 'Bytes. Enforced again at confirm time against R2 HeadObject.' })
  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024) // 20MB ceiling — generous for a full-page screenshot PNG, well below files module's 100MB (marketing images, not drawings/videos)
  sizeBytes!: number;
}
