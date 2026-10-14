-- AlterTable
ALTER TABLE "payroll_entries" ADD COLUMN "customerOrderId" UUID;

-- CreateIndex
CREATE INDEX "payroll_entries_companyId_customerOrderId_idx" ON "payroll_entries"("companyId", "customerOrderId");

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
