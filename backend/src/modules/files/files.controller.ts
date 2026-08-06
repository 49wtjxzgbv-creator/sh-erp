import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreatePresignedUploadDto } from './dto/create-presigned-upload.dto';
import { FilesService } from './files.service';

@ApiTags('files')
@Controller({ path: 'files', version: '1' })
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('presigned-upload')
  @RequirePermissions('files:write')
  @ApiOperation({ summary: 'Step 1 of upload: get a FileAsset id + a short-lived presigned PUT URL to R2.' })
  async createPresignedUpload(@CurrentUser() user: RequestUser, @Body() dto: CreatePresignedUploadDto) {
    return this.filesService.createPresignedUpload(user, dto);
  }

  @Post(':id/confirm')
  @RequirePermissions('files:write')
  @ApiOperation({ summary: 'Step 2 of upload: confirm the direct-to-R2 PUT succeeded and matches the declared size.' })
  async confirm(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.filesService.confirmUpload(user, id);
  }

  @Get(':id/download-url')
  @RequirePermissions('files:read')
  @ApiOperation({ summary: 'Short-lived presigned GET URL — files are never proxied through the API.' })
  async downloadUrl(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.filesService.getDownloadUrl(user, id);
  }

  @Get()
  @RequirePermissions('files:read')
  @ApiOperation({ summary: 'List (non-deleted) files attached to a given entity.' })
  async listForEntity(
    @CurrentUser() user: RequestUser,
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
  ) {
    return this.filesService.listForEntity(user, entityType, entityId);
  }

  @Get('batch')
  @RequirePermissions('files:read')
  @ApiOperation({
    summary:
      'Files for MANY entities of the same type in one call — avoids an N-request fan-out from a list view ' +
      '(e.g. a 50-row product list rendering a thumbnail per row).',
  })
  async listForEntities(
    @CurrentUser() user: RequestUser,
    @Query('entityType') entityType: string,
    @Query('entityIds') entityIds: string,
  ) {
    return this.filesService.listForEntities(user, entityType, entityIds.split(',').filter(Boolean));
  }

  @Delete(':id')
  @RequirePermissions('files:write')
  @ApiOperation({ summary: 'Soft-delete a file attachment.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.filesService.delete(user, id);
  }
}
