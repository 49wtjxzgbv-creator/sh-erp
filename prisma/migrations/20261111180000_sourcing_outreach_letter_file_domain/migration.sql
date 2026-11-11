-- Outreach-letter PDF (2026-11-11): FileAsset.domain gains
-- SOURCING_OUTREACH_LETTER so the generated "заявка на прорахунок" for a
-- candidate supplier is persisted (a real presigned download URL, not a
-- client-only blob: URL — see SourcingAppService#generateOutreachLetter's
-- own comment). No table changes — additive enum value only.
ALTER TYPE "FileDomain" ADD VALUE 'SOURCING_OUTREACH_LETTER';
