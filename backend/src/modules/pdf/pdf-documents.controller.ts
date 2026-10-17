import { Body, Controller, Delete, Get, Param, Patch, Post, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreatePdfPresignedUploadDto, RenamePdfDocumentDto } from './dto/pdf-document.dto';
import { PdfDocumentsService } from './pdf-documents.service';

@ApiTags('pdf')
@Controller({ path: 'pdf-documents', version: '1' })
export class PdfDocumentsController {
  constructor(private readonly pdfDocumentsService: PdfDocumentsService) {}

  @Get()
  @RequirePermissions('files:read')
  @ApiOperation({ summary: 'The company\'s PDF library, most recently updated first.' })
  async list(@CurrentUser() user: RequestUser) {
    return this.pdfDocumentsService.list(user);
  }

  @Post('presigned-upload')
  @RequirePermissions('files:write')
  @ApiOperation({ summary: 'Step 1 of uploading (or saving an edited) PDF — get a document id + a short-lived presigned PUT URL to R2.' })
  async createPresignedUpload(@CurrentUser() user: RequestUser, @Body() dto: CreatePdfPresignedUploadDto) {
    return this.pdfDocumentsService.createPresignedUpload(user, dto);
  }

  @Post(':id/confirm')
  @RequirePermissions('files:write')
  @ApiOperation({ summary: 'Step 2 — confirm the direct-to-R2 PUT succeeded and matches the declared size.' })
  async confirmUpload(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.pdfDocumentsService.confirmUpload(user, id);
  }

  @Get(':id/content')
  @RequirePermissions('files:read')
  @ApiOperation({ summary: 'Streams the raw PDF bytes same-origin (see the service\'s own header comment for why this isn\'t a direct R2 presigned URL).' })
  async getContent(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const { body, sizeBytes } = await this.pdfDocumentsService.getContent(user, id);
    return new StreamableFile(body as any, { type: 'application/pdf', length: sizeBytes });
  }

  @Patch(':id')
  @RequirePermissions('files:write')
  @ApiOperation({ summary: 'Rename a library document.' })
  async rename(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: RenamePdfDocumentDto) {
    return this.pdfDocumentsService.rename(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('files:write')
  @ApiOperation({ summary: 'Soft-delete a library document.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.pdfDocumentsService.delete(user, id);
  }
}
