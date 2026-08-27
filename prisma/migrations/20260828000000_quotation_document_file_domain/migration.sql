-- Quotations module (2026-08-28): FileAsset.domain gains QUOTATION_DOCUMENT
-- for Playwright-rendered quotation PDFs (see QuotationPdfService). No table
-- changes — additive enum value only.
ALTER TYPE "FileDomain" ADD VALUE 'QUOTATION_DOCUMENT';
