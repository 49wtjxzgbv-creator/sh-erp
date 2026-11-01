import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ExtractDefaultShapeDto {
  @ApiProperty({ description: 'FileAsset id of an already-uploaded STEP/STP 3D CAD file — see FilesModule\'s presigned-upload flow, domain PRODUCT_DOCUMENT.' })
  @IsUUID()
  fileAssetId!: string;
}
