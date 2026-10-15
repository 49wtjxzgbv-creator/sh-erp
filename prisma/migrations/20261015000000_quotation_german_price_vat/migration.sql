-- AlterEnum
ALTER TYPE "PricingSource" ADD VALUE 'GERMAN_PRICE_INCL_VAT';

-- AlterTable
ALTER TABLE "quotation_versions" ADD COLUMN "vatRatePercent" DECIMAL(5,2);
