# ADR-0004: Cloudflare R2 as the file storage provider

**Status**: Accepted (2026-08-04)

## Context
The old system stored photos, drawings, invoices, customer documents, QC photos, and branding assets on Google Drive (Phase 1 §8). The new system needs an S3-compatible object store, chosen with the specified target scale (thousands of companies routinely viewing, not just writing, files) in mind.

## Decision
Cloudflare R2, addressed through the S3-compatible API, with the key layout `tenants/{companyId}/{domain}/{entityType}/{entityId}/{filename}` (Phase 2 §7) mapping directly onto the old Drive folder taxonomy.

## Consequences
- Positive: zero egress fees — material specifically because this product's usage pattern is read-heavy (users repeatedly viewing product photos, drawings, invoices), unlike a write-once-read-rarely archive.
- Positive: S3-compatible API means this is not a lock-in decision — an S3 adapter is a configuration change behind the same storage interface, not a rewrite.
- Neutral: R2 is a newer product than S3 with a smaller operational track record — mitigated by the storage-provider abstraction (Phase 2 §7/§18) making a future switch low-cost if it's ever warranted.

## Alternatives considered
- **Amazon S3**: viable, more mature, but egress costs would scale unfavorably with the read-heavy usage pattern across many companies.
- **Continuing with Google Drive**: rejected outright — Drive is not designed as an application object store (Phase 1 documents real friction: no first-class public-CDN URLs, sharing-permission model built for human collaboration not application access, thumbnail-URL hacks used for PDF previews).
