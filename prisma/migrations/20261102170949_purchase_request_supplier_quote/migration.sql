-- AlterTable
ALTER TABLE "purchase_request_items" ADD COLUMN     "supplierQuotedPrice" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "purchase_requests" ADD COLUMN     "supplierRespondedAt" TIMESTAMPTZ(3);
