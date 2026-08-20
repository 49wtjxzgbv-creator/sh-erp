import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

/**
 * `content` stays a coarse `@IsObject()` rather than a deep nested
 * class-validator tree (one class per section/locale) — same pragmatic
 * choice already made for `Plan.limits`/`UpsertPlanDto` (`@IsObject()`
 * over a full schema): this is a Super-Admin-only, JSON-shaped field, and
 * `landing-page-admin.service.ts` does a lightweight structural check
 * (required top-level keys present) before saving, which is proportionate
 * to who can reach this endpoint at all (SuperAdminGuard).
 */
export class SaveLandingPageDraftDto {
  @ApiProperty({ description: 'LandingPageContent shape — see landing-page-content.types.ts.' })
  @IsObject()
  content!: Record<string, unknown>;
}
