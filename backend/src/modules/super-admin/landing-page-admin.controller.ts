import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SuperAdminGuard, CurrentSuperAdmin, RequestSuperAdmin } from './super-admin-context';
import { LandingPageAdminService } from './landing-page-admin.service';
import { LandingPageMediaService } from './landing-page-media.service';
import { SaveLandingPageDraftDto } from './dto/save-landing-page-draft.dto';
import { CreateLandingMediaUploadDto } from './dto/create-landing-media-upload.dto';

@ApiTags('super-admin')
@ApiBearerAuth()
@Public()
@UseGuards(SuperAdminGuard)
@Controller({ path: 'super-admin/landing-page', version: '1' })
export class LandingPageAdminController {
  constructor(
    private readonly landingPageAdminService: LandingPageAdminService,
    private readonly landingPageMediaService: LandingPageMediaService,
  ) {}

  @Get('draft')
  @ApiOperation({ summary: '[Super Admin] Get the current draft (lazily created from the published content on first visit).' })
  async getDraft(@CurrentSuperAdmin() actor: RequestSuperAdmin) {
    return this.landingPageAdminService.getDraft(actor);
  }

  @Put('draft')
  @ApiOperation({ summary: '[Super Admin] Save the draft.' })
  async saveDraft(@CurrentSuperAdmin() actor: RequestSuperAdmin, @Body() dto: SaveLandingPageDraftDto) {
    return this.landingPageAdminService.saveDraft(actor, dto);
  }

  @Post('draft/discard')
  @ApiOperation({ summary: '[Super Admin] Discard unsaved draft edits, reverting to the current published content.' })
  async discardDraft(@CurrentSuperAdmin() actor: RequestSuperAdmin) {
    return this.landingPageAdminService.discardDraft(actor);
  }

  @Post('publish')
  @ApiOperation({ summary: '[Super Admin] Publish the draft — archives the current published version and snapshots the draft into a new one.' })
  async publish(@CurrentSuperAdmin() actor: RequestSuperAdmin) {
    return this.landingPageAdminService.publish(actor);
  }

  @Get('versions')
  @ApiOperation({ summary: '[Super Admin] Publish history (published + archived versions, content excluded).' })
  async listVersions() {
    return this.landingPageAdminService.listVersions();
  }

  @Get('versions/:id')
  @ApiOperation({ summary: '[Super Admin] Full content of one historical version.' })
  async getVersion(@Param('id') id: string) {
    return this.landingPageAdminService.getVersion(id);
  }

  @Post('versions/:id/restore')
  @ApiOperation({ summary: '[Super Admin] Copy an old version into the draft (still requires Publish to go live).' })
  async restoreVersion(@CurrentSuperAdmin() actor: RequestSuperAdmin, @Param('id') id: string) {
    return this.landingPageAdminService.restoreVersion(actor, id);
  }

  @Post('media/presigned-upload')
  @ApiOperation({ summary: '[Super Admin] Step 1 of uploading a marketing image — create the row + get a presigned PUT URL.' })
  async createMediaUpload(@CurrentSuperAdmin() actor: RequestSuperAdmin, @Body() dto: CreateLandingMediaUploadDto) {
    return this.landingPageMediaService.createPresignedUpload(actor, dto);
  }

  @Post('media/:id/confirm')
  @ApiOperation({ summary: '[Super Admin] Step 2 — confirm the direct-to-R2 upload actually succeeded.' })
  async confirmMediaUpload(@CurrentSuperAdmin() actor: RequestSuperAdmin, @Param('id') id: string) {
    return this.landingPageMediaService.confirmUpload(actor, id);
  }

  @Get('media')
  @ApiOperation({ summary: '[Super Admin] Media library — every uploaded marketing image.' })
  async listMedia() {
    return this.landingPageMediaService.list();
  }

  @Delete('media/:id')
  @ApiOperation({ summary: '[Super Admin] Delete a marketing image (blocked if still referenced by the published homepage).' })
  async deleteMedia(@CurrentSuperAdmin() actor: RequestSuperAdmin, @Param('id') id: string) {
    return this.landingPageMediaService.delete(actor, id);
  }
}
