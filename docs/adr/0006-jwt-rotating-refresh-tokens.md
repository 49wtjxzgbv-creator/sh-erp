# ADR-0006: JWT access tokens + rotating refresh tokens, not server-side sessions

**Status**: Accepted (2026-08-04)

## Context
The old system used a single opaque session token cached in `CacheService` (8h TTL) and stored client-side in `sessionStorage` — reasonable for a single-installation Apps Script app, but it has real gaps for a multi-tenant, horizontally-scaled, multi-device commercial product: no refresh/rotation, `sessionStorage` is JS-readable (XSS-exposed), and logout only cleared a cache entry rather than revoking anything durable (Phase 1 §1.2/§10.3, Phase 2 §5).

## Decision
Short-lived signed JWT access tokens (~15 min, containing `sub`, `company_id`, `role_ids`) for authenticating requests statelessly (no server-side lookup needed to validate a request, which matters for horizontal scaling — Phase 2 §16/§24), plus a long-lived, rotating, hashed-at-rest refresh token stored server-side and delivered to web clients via an `httpOnly` `Secure` `SameSite=Lax` cookie. Refresh-token reuse (a signal of theft) revokes the entire session family immediately.

## Consequences
- Positive: access-token validation requires no DB/Redis round trip, which is what lets the API tier stay stateless and horizontally scale without code changes (ADR-0001, Phase 2 §24).
- Positive: refresh token is inaccessible to JS (closes the old `sessionStorage` XSS exposure) on web; mobile clients (Phase 2 §23) use the same refresh endpoint with device-secure-storage instead of a cookie — one auth backend serves both.
- Positive: real, durable logout/revocation — a genuine capability gap in the old system, now closed.
- Negative: access tokens can't be instantly revoked mid-lifetime (a compromised access token is valid until it expires, ~15 min) — accepted as a standard, well-understood trade-off of stateless JWTs, mitigated by the short expiry itself and by refresh-token-family revocation stopping any *further* access tokens from being issued.

## Alternatives considered
- **Server-side sessions (Redis-backed, as a direct evolution of the old `CacheService` pattern)**: viable and simpler to reason about, but requires a Redis lookup on every authenticated request and reintroduces a form of state the API tier would depend on for basic auth — rejected in favor of the stateless-access-token approach specifically because it's cleaner for horizontal scaling (Phase 2 §24) and mobile-readiness (Phase 2 §23).
