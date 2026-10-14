-- AlterTable
ALTER TABLE "payroll_entries" ADD COLUMN "voidsEntryId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "payroll_entries_voidsEntryId_key" ON "payroll_entries"("voidsEntryId");

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_voidsEntryId_fkey" FOREIGN KEY ("voidsEntryId") REFERENCES "payroll_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
