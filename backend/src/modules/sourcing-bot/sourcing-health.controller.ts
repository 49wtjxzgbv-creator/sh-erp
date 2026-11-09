import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';

/**
 * `GET /health` for the sourcing-bot process's new HTTP listener
 * (2026-11-10 — see `main.ts`'s header comment for why this process now
 * has one). Mirrors the main backend's own `HealthController` shape
 * (unversioned, outside the global prefix) so `ops/deploy.sh` can verify
 * this process the same way it already verifies `sh-erp-backend` — no
 * guard applies here (none is registered globally on this app, only on
 * `SourcingAppController`), so no `@Public()`-equivalent is needed.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class SourcingHealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
