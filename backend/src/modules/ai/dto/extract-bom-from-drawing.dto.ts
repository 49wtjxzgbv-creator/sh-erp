import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ExtractBomFromDrawingDto {
  @ApiProperty({ description: 'FileAsset id of an already-uploaded technical drawing (PDF or image) — see FilesModule\'s presigned-upload flow, domain ASSEMBLY_DRAWING.' })
  @IsUUID()
  fileAssetId!: string;
}
