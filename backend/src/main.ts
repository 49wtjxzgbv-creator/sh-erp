import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

// Bootstrap. API versioning is URI-path (`/api/v1/...`), per ADR-0008 — every
// route below is auto-prefixed once controllers declare `@Controller({ path: 'x', version: '1' })`.
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Real, serious gap found during the pre-Hostinger-launch audit —
  // affects BOTH deployment paths, not just Hostinger, and was never
  // caught earlier because it only manifests once this app actually sits
  // behind a reverse proxy (Nginx on the Hostinger VPS path, Railway's own
  // edge on the managed path — never true for local dev or a bare `curl`
  // straight at this process, which is presumably why every prior
  // verification pass missed it). Express's `req.ip` (what
  // `ThrottlerModule` keys its per-client rate limit on, `app.module.ts`'s
  // `{ ttl: 60_000, limit: 100 }`) defaults to the immediate TCP peer's
  // address — behind a reverse proxy, that's the PROXY's address, the same
  // for every real client. Without `trust proxy`, every user behind Nginx
  // would appear to share one IP and one shared 100-req/60s budget: once
  // any combination of real users crosses that ceiling, ALL of them start
  // getting 429'd together, not just whichever one was actually abusive.
  // `1` (trust exactly one hop) is correct for both real topologies here —
  // one Nginx in front on Hostinger, one Railway edge layer on the managed
  // path — and reads the real client IP from the `X-Forwarded-For` header
  // the proxy sets, which both `ops/nginx/*.conf.template` (this pass) and
  // Railway's own edge already do.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // `health` excluded from the global prefix/versioning — a healthcheck
  // target (Railway, uptime pingers, Docker) should be a stable,
  // unversioned path, not tied to this API's version scheme.
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Real gap found and fixed during the production-readiness / deployment-
  // documentation pass: frontend/lib/api-client/http.ts calls this API
  // straight from the browser for every module except the 3 Next-owned auth
  // routes ("every other module talks to this URL straight from the
  // browser," per that file's own header comment), carrying the access
  // token as a Bearer header, not a cookie. On the real deployment topology
  // (Phase 2 §17.3/§17.4 — Vercel frontend, Railway API, different origins)
  // that is a genuine cross-origin request, and this app had no CORS
  // configuration at all — every one of those calls would have been
  // rejected by the browser in production despite working by accident in
  // any same-origin/localhost-only manual testing. `credentials: true` here
  // is intentionally forward-compatible with the auth cookie's own use
  // (RefreshToken flow, ADR-0006), even though the Bearer-header calls this
  // fixes today don't themselves rely on cookies. FRONTEND_URL is unset by
  // default in dev (see backend/.env.example) — `origin: true` then reflects
  // whatever Origin the request sent (permissive, matches this repo's other
  // local-dev-only placeholder defaults, e.g. JWT_ACCESS_SECRET). A real
  // deployment MUST set FRONTEND_URL to the actual Vercel origin(s); leaving
  // it unset in production would silently keep the permissive reflect-any-
  // origin behavior, which is the wrong tradeoff once credentials are ever
  // added — see docs/deployment.md's env-var checklist.
  const frontendUrl = process.env.FRONTEND_URL;
  app.enableCors({
    origin: frontendUrl ? frontendUrl.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });

  // Swagger on every endpoint is an explicit owner requirement (Phase 2
  // requirement #7) — documented here at the app level, enforced per-module
  // by DTOs carrying @ApiProperty and controllers carrying @ApiTags/@ApiOperation.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SH ERP API')
    .setDescription('SH ERP v2 — commercial multi-tenant ERP API. See docs/adr for architecture decisions.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // Strongly-typed input everywhere (Phase 2 requirement #8) — reject any
  // request body field not declared on the DTO, rather than silently
  // dropping or accepting it.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // `HOST` added for the native (non-Docker) Hostinger systemd deployment
  // path (docs/deployment.md) — defaults to every interface (Node's own
  // default when no host is passed) so the Docker/Railway paths, which
  // rely on the container/platform boundary instead, keep working exactly
  // as before. Set HOST=127.0.0.1 in the native path's backend.env so
  // Nginx is the only thing that can ever reach this process, matching
  // docker-compose.prod.yml's own "127.0.0.1 only" principle for the
  // container path.
  const port = process.env.PORT ?? 3000;
  const host = process.env.HOST || undefined;
  if (host) {
    await app.listen(port, host);
  } else {
    await app.listen(port);
  }
}
bootstrap();
