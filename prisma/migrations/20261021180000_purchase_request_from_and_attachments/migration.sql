-- "від кого додай логотип компанії ... додай можливість редагувати" /
-- "додай можливість додавати файли з товарів ... окремо до кожної позиції"
-- (2026-10-21) — see PurchaseRequest.fromName / PurchaseRequestItem.attachedFileIds's own schema.prisma comments.

-- AlterTable
ALTER TABLE "purchase_requests" ADD COLUMN "fromName" TEXT;

-- AlterTable
ALTER TABLE "purchase_request_items" ADD COLUMN "attachedFileIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
