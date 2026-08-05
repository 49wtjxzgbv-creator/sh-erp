# ADR-0003: NestJS + Prisma + PostgreSQL as the core backend stack

**Status**: Accepted (2026-08-04)

## Context
The owner specified the target stack in Phase 0 (Next.js/NestJS/PostgreSQL/Prisma/R2-or-S3/JWT). This ADR records why that stack holds up under the Phase 2 requirements (strong typing, testability, Swagger-documented API, Prisma-only migrations).

## Decision
NestJS for the API (structured DI, first-class Swagger integration via `@nestjs/swagger`, built-in versioning, guard/interceptor pipeline that maps cleanly onto the cross-cutting concerns in Phase 2 §2.3). Prisma as the sole ORM/migration tool (typed client generation keeps DB schema and application types from drifting apart; `prisma migrate` is the only sanctioned way schema changes reach any environment, per requirement #6). PostgreSQL as the database (native Row-Level Security for multi-tenancy per ADR-0002, mature JSON support for the few places jsonb is genuinely appropriate, proven at the target scale).

## Consequences
- Positive: strong typing flows end-to-end — Prisma's generated types feed DTOs feed the OpenAPI spec feed the generated frontend client (Phase 2 §3.3) — a single source of truth for shapes, directly satisfying requirement #8.
- Positive: NestJS's testing utilities (module overrides, easy Prisma mocking) make requirement #10 ("every feature testable") practical rather than aspirational.
- Negative: Prisma's single-schema-file model means true per-module schema separation (ADR supporting plugin architecture, Phase 2 §18) is a convention, not a hard boundary — documented as a known limitation, not hidden.

## Alternatives considered
- **TypeORM instead of Prisma**: rejected — weaker migration-safety guarantees and a less reliable generated-type story for the strict-typing requirement.
- **Express instead of NestJS**: rejected — would require hand-rolling the DI, module boundary enforcement, and Swagger integration NestJS provides out of the box, all of which are load-bearing for other Phase 2 decisions (ADR-0001, requirement #7).
- **MongoDB or another NoSQL store**: rejected — the domain (production orders, BOMs, payroll, financial reporting) is fundamentally relational, with real referential integrity requirements (Phase 1 identified several places where implicit relations already caused bugs, e.g. §10.4/§10.8) that a document store would make harder, not easier, to guarantee correctly.
