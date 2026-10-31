import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ExtractComponentsFromStepDto {
  @ApiProperty({ description: 'FileAsset id of an already-uploaded STEP/STP 3D CAD file — see FilesModule\'s presigned-upload flow, domain ASSEMBLY_3D_MODEL.' })
  @IsUUID()
  fileAssetId!: string;
}
