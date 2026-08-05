# ADR-0008: URI-path API versioning (`/api/v1/...`), not header-based

**Status**: Accepted (2026-08-04)

## Context
The old system had no API versioning concept at all — the client called server functions by string name through a whitelist (Phase 1 §1.1), and any change to a function's signature was a breaking change with no migration path or deprecation signal. The new system needs versioning from day one (owner requirement #4) plus a stated deprecation strategy (Phase 2 §20).

## Decision
Version in the URI path (`/api/v1/products`, later `/api/v2/products` for breaking changes only), using NestJS's built-in URI versioning so multiple versions run concurrently in one deployment.

## Consequences
- Positive: visible and unambiguous in logs, browser network tabs, Swagger docs, and API client generation — a developer (internal or, later, external/third-party) always knows which contract they're calling without inspecting headers.
- Positive: simple to reason about for deprecation tooling (Phase 2 §20) — `Deprecation`/`Sunset` headers attach naturally per versioned route.
- Negative: a "breaking change" requires duplicating the affected controller(s) under a new version path rather than content-negotiating a single route — accepted, since it makes exactly what changed between versions explicit and reviewable in a diff, rather than implicit in a header-parsing branch.

## Alternatives considered
- **Header-based versioning (e.g. `Accept: application/vnd.sherp.v2+json`)**: technically defensible, more "RESTful" by some conventions, but less discoverable and harder to test/demo/document for a product whose API may eventually be a customer-facing integration surface (Phase 2 §20) — rejected in favor of the more obvious, more widely-understood URI-path convention.
