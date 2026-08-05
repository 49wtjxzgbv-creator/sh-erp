# ADR-0005: BullMQ + Redis for background jobs

**Status**: Accepted (2026-08-04)

## Context
The old system used Apps Script time-driven triggers (daily low-stock digest, minute-by-minute Telegram polling) as its only background-execution mechanism — a structural limitation of the platform, not a design choice (Phase 1 §7, §9). The new system needs a proper job queue for scheduled work (digest emails, backup jobs, restore drills) and async work (Excel import, AI invoice OCR, report generation, file processing) that shouldn't block an API request thread.

## Decision
BullMQ backed by Redis, with per-domain queues (`inventory`, `ai`, `reports`, `notifications`) so one company's slow job can't starve another's, run by a worker process deployed separately from the API (Phase 2 §9/§17.1) so it scales independently.

## Consequences
- Positive: directly removes the old system's single-threaded, one-execution-at-a-time Apps Script constraint — multiple companies' background work runs concurrently, isolated by queue.
- Positive: retries, backoff, and dead-letter handling come from the library, not hand-rolled (the old system's `pollTelegramUpdates_`/`dailyLowStockDigest_` had ad hoc, function-specific error handling instead).
- Positive: the same Redis instance already required for caching/rate-limiting/sessions (Phase 2 §10.1) backs the queue, with separate key namespaces — no additional infrastructure dependency introduced.
- Negative: introduces Redis as a hard dependency for correctness (not just a cache that can be safely cold on restart) — mitigated by using a managed Redis provider with its own durability/backup story.

## Alternatives considered
- **Postgres-backed job queue (e.g. `pg-boss`)**: viable, one fewer infrastructure dependency, but weaker ecosystem tooling and throughput ceiling versus BullMQ/Redis at the target scale — reconsider only if operating Redis becomes a genuine burden, which is not expected at this scale.
- **Cloud-provider-managed queue (e.g. SQS)**: rejected for now — ties the architecture to a specific cloud provider ahead of any proven need, working against the deliberately provider-flexible deployment story (Railway/Vercel/Supabase, Phase 2 §13).
