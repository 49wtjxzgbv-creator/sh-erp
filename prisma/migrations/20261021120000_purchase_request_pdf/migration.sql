-- "додай можливість кидати цю заявку постачальнику тобто робити пдф файл
-- заявки" (2026-10-21): generate/store a real PDF of a PurchaseRequest, same
-- Playwright-render + FileAsset mechanism as Quotation's QUOTATION_DOCUMENT —
-- see PurchaseRequest.pdfFileId's own schema.prisma comment.

-- AlterEnum
ALTER TYPE "FileDomain" ADD VALUE 'PURCHASE_REQUEST_DOCUMENT';

-- AlterTable
ALTER TABLE "purchase_requests" ADD COLUMN "pdfFileId" UUID;
