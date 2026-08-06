import {
  Controller,
  Get,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * `GET /health` — added during the production-readiness pass. Real gap
 * found while writing deployment documentation: "SH ERP v2 — Phase 2
 * Architecture.md" §14/§17.3 both name `/health` as the uptime-pinger and
 * Railway-healthcheck target, but no such endpoint had ever actually been
 * built across Phases 5-6 — only a passing mention in `Public()`'s own doc
 * comment ("e.g. login, register, health check"). Disclosed and fixed here
 * rather than left as a dangling reference in the deployment docs.
 *
 * Deliberately outside the global `api`/versioning prefix (see
 * `main.ts`'s `setGlobalPrefix('api', { exclude: ['health'] })`) — a
 * healthcheck target should be a stable, unversioned path a load balancer
 * or uptime pinger can hit without knowing this API's version scheme.
 * `@Controller({ version: VERSION_NEUTRAL })` is required for that: URI
 * versioning still applies to a route even when it's excluded from
 * `globalPrefix`, unless the controller itself opts out — found as a real
 * bug during the first Hostinger deploy (`/health` 404'd, breaking
 * `ops/deploy.sh`'s post-deploy verification step and Nginx health checks)
 * and fixed here rather than left broken.
 * `@Public()` so it works before any auth is established (the whole point
 * of a healthcheck), and does one real check — a live Postgres query, not
 * just "the process is running" — since a backend that's up but can't
 * reach its database is not actually healthy.
 */
@ApiTags('health')
@Controller({
  path: 'health',
  version: VERSION_NEUTRAL,
})
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException(
        'Database connectivity check failed.',
      );
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
