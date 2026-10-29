-- AlterEnum
-- Multi-currency module (2026-10-29), phase 5 — adds PLN (Polish złoty) as
-- a fourth selectable currency alongside EUR/UAH/USD, for every row/company
-- that already carries a plain `Currency` column.
ALTER TYPE "Currency" ADD VALUE 'PLN';
