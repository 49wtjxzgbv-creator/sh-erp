import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * End-to-end test for Module 1's core flow: signup a company, log in as its
 * owner, confirm the access token actually gates a protected route.
 *
 * REQUIRES a real Postgres reachable via DATABASE_URL, with migrations
 * applied and the RLS/CHECK-constraint raw SQL from database-schema.md §2/§2b
 * already run — this is an integration test, not a unit test, and is the
 * first real exercise of the schema against the actual Prisma engine
 * outside the static checker (see the standing "run prisma validate for
 * real" requirement in the Phase 3 docs). Skipped automatically if
 * DATABASE_URL isn't set, so `npm test` (unit tests only) stays usable
 * without a live database.
 */
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Tenancy + Auth (e2e)', () => {
  let app: INestApplication;
  const slug = `e2e-test-${Date.now()}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs up a company + owner user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/companies/signup')
      .send({
        companyName: 'E2E Test Co',
        slug,
        ownerEmail: `owner-${slug}@example.com`,
        ownerPassword: 'a-very-strong-password-123',
        ownerFullName: 'Test Owner',
      })
      .expect(201);

    expect(res.body.slug).toBe(slug);
  });

  it('logs in and receives a token pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: `owner-${slug}@example.com`,
        password: 'a-very-strong-password-123',
        companySlug: slug,
      })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('rejects login with the wrong password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `owner-${slug}@example.com`, password: 'wrong', companySlug: slug })
      .expect(401);
  });
});
