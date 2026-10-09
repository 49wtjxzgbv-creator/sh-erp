-- AlterTable
ALTER TABLE "file_assets"
  ADD COLUMN "optimizationStatus" "FileConversionStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "optimizedStorageKey" TEXT;
