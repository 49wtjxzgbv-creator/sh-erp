# ADR-0007: Build feature flags in-house, not a managed SaaS

**Status**: Accepted (2026-08-04)

## Context
The owner requires unfinished functionality to be deployable but disabled (Phase 2 §19), enabling `git push`-only continuous delivery (Phase 2 §17) without long-lived feature branches.

## Decision
A small in-house `FeatureFlagsModule`: a `feature_flags` table (global default + optional per-company override), Redis-cached, checked via a route guard/decorator server-side and exposed to the frontend at app-shell boot.

## Consequences
- Positive: no new paid vendor dependency for a need that, at this stage, is purely "ship dark, enable gradually, kill-switch if something breaks" — not experimentation/analytics.
- Positive: the interface is deliberately narrow (`isEnabled(flagKey, companyId?)`), so swapping in a managed provider later is a contained change behind that same boundary, not a rewrite.
- Negative: no built-in experimentation/A-B-testing tooling, gradual percentage rollout UI, or flag-change audit trail out of the box — acceptable now, revisited if/when those specific capabilities are actually needed.

## Alternatives considered
- **Managed flag SaaS (e.g. LaunchDarkly-class product)**: rejected for now — real capability, but adds a paid vendor dependency and an external call on a hot path (auth/permission-adjacent) for a need the in-house version already satisfies; revisit if experimentation features become a real product requirement.
