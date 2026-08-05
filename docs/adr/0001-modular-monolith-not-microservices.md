# ADR-0001: Modular monolith, not microservices

**Status**: Accepted (2026-08-04)

## Context
SH ERP v2 must satisfy "every module must be independent and scalable" (owner requirement) while being buildable and operable by a small team, at a target scale of thousands of companies and millions of records.

## Decision
Build one NestJS application, internally organized into strictly-bounded modules (one per business domain, mapped 1:1 onto the Phase 1 `.gs` file inventory). Modules interact only through exported service interfaces or in-process domain events — never by reaching into another module's Prisma models directly. Background job workers already run as a separate deployable process from the API (BullMQ, see ADR-0005), which is the load pattern most likely to need independent scaling first.

## Consequences
- Positive: no distributed-transaction complexity, no service-to-service auth/network overhead, fast local development, one deployable to reason about for most of the system.
- Positive: the module-boundary discipline (enforced by lint rules, see Phase 2 §22) means any module that later needs independent scaling can be extracted with a mechanical refactor, not a rewrite.
- Negative: the whole API tier currently scales as one unit (mitigated by it being stateless and horizontally replicable — Phase 2 §16/§24) — a single module cannot be scaled independently of the others *within the API tier itself* until/unless it's extracted.
- Negative: a bug in one module's process can in principle affect the whole API process's memory/CPU envelope (mitigated by resource limits and by workers already being a separate process).

## Alternatives considered
- **Microservices from day one**: rejected — the operational tax (service discovery, distributed transactions, inter-service auth, observability across service boundaries) isn't justified by current team size or proven load, and "independent and scalable" is better served here by disciplined boundaries + a real extraction path than by paying that tax speculatively.
- **Single unstructured Express/Nest app with no module boundaries**: rejected — this is what the old Apps Script system effectively was (one big script surface with implicit coupling); it directly contradicts "do not migrate technical debt."
