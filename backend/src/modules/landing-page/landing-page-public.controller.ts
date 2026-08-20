import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { LandingPagePublicService } from './landing-page-public.service';

/**
 * Zero-auth, public read side of the landing-page feature — deliberately
 * its own top-level module (see landing-page.module.ts's header comment),
 * not nested inside super-admin/, since that module's providers are
 * private-by-convention and a zero-auth controller has no business sitting
 * next to SuperAdminGuard-protected ones.
 */
@ApiTags('landing-page')
@Public()
@Controller({ path: 'landing-page', version: '1' })
export class LandingPagePublicController {
  constructor(private readonly landingPagePublicService: LandingPagePublicService) {}

  @Get()
  @ApiOperation({ summary: 'The current PUBLISHED homepage content + live Plan rows — never DRAFT/ARCHIVED.' })
  async get() {
    return this.landingPagePublicService.getPublished();
  }

  @Get('media/:id')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @ApiOperation({ summary: 'Public streaming proxy for a marketing image — see landing-page-public.service.ts#getMediaObject for why this exists instead of a public R2 domain.' })
  async getMedia(@Param('id') id: string) {
    const { body, contentType, contentLength } = await this.landingPagePublicService.getMediaObject(id);
    return new StreamableFile(body as any, { type: contentType, length: contentLength });
  }
}
