-- AlterTable
ALTER TABLE "file_assets"
  ADD COLUMN "mobileOptimizationStatus" "FileConversionStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "mobileOptimizedStorageKey" TEXT;
