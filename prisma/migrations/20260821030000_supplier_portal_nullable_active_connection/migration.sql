-- Migration: supplier_portal_nullable_active_connection (P3, 2026-08-21)
--
-- A standalone self-registered Supplier Portal account (no invite token,
-- zero SupplierConnections at all — see the P2 self-registration work)
-- must still be able to log in and hold a session, so it can see itself
-- accepted/found by a company later. `supplier_portal_refresh_tokens
--.activeConnectionId` was NOT NULL, which made issuing ANY refresh token
-- for such an account structurally impossible.
--
-- Safe, single-statement, backward-compatible: relaxes a constraint only,
-- touches no existing rows (every row today already has a real value),
-- and doesn't touch the FK itself — Postgres never enforces a foreign key
-- against a NULL value, so no separate FK change is needed.
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-
-- authored migration in this project.

ALTER TABLE "supplier_portal_refresh_tokens" ALTER COLUMN "activeConnectionId" DROP NOT NULL;
