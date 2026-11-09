-- "чомусь воно зробило кожну заявку окремим замовленням постачальнику а не
-- одним файлом" (2026-11-09) — the one combined PDF shared across every
-- sibling PurchaseOrder fanned out from the same заявка conversion.
ALTER TABLE "purchase_orders" ADD COLUMN "combinedPdfFileId" UUID;
