-- AlterTable
ALTER TABLE "file_assets"
  ADD COLUMN "arOptimizationStatus" "FileConversionStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "arOptimizedStorageKey" TEXT;
