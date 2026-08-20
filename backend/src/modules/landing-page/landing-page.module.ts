import { Module } from '@nestjs/common';
import { LandingPagePublicController } from './landing-page-public.controller';
import { LandingPagePublicService } from './landing-page-public.service';

/**
 * Public read side of the Landing Page feature (2026-08-20 spec) —
 * deliberately its own top-level module, registered in AppModule alongside
 * every other feature module, NOT nested inside super-admin/. That module's
 * providers (SuperAdminGuard, SuperAdminPrismaService, ...) are
 * private-by-convention (no `exports` array) — a zero-auth, public
 * controller has no business sitting next to them, where a future change
 * inside that module could too easily assume "everything in here is
 * guarded." The write side (draft/publish/media) lives in
 * ../super-admin/landing-page-admin.* instead, guarded by SuperAdminGuard
 * exactly like every other Super Admin resource.
 */
@Module({
  controllers: [LandingPagePublicController],
  providers: [LandingPagePublicService],
})
export class LandingPageModule {}
