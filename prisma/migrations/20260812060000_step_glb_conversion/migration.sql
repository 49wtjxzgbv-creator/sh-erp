-- CreateEnum
CREATE TYPE "FileConversionStatus" AS ENUM ('NONE', 'PENDING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "file_assets"
  ADD COLUMN "conversionStatus" "FileConversionStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "convertedStorageKey" TEXT;
