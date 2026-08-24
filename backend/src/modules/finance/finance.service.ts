import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePurchaseOrderDocumentDto, QueryFinancePurchaseOrdersDto, UpdatePurchaseOrderDocumentDto } from './dto/finance-document.dto';
import { CreatePurchaseOrderPaymentDto } from './dto/finance-payment.dto';
import { CreatePurchaseOrderExpenseDto, UpdatePurchaseOrderExpenseDto } from './dto/finance-expense.dto';

export type FinancePaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';
export type DocumentPaymentStatus = 'NO_AMOUNT' | FinancePaymentStatus;

export interface FinanceCurrencyBucket {
  currency: string;
  additionalExpenses: number;
  totalDocuments: number;
  paid: number;
  unpaidPerDocuments: number;
}

export interface PurchaseOrderFinanceSummary {
  purchaseOrderId: string;
  primaryCurrency: string;
  // Six numbers, deliberately kept separate — see schema.prisma's Finance
  // section header comment for the full rationale behind never blending
  // these into one "amount due" figure.
  goodsCost: number;
  additionalExpenses: number;
  actualCost: number;
  totalDocuments: number;
  paid: number;
  unpaidPerDocuments: number;
  documentCount: number;
  lastActivityAt: Date | null;
  // Any currency other than `primaryCurrency` present on this PO's
  // documents/expenses/payments — surfaced as its own bucket, never summed
  // into the primary-currency figures above (point 7 of the confirmed design).
  otherCurrencies: FinanceCurrencyBucket[];
}

type PoItemForCost = { qtyOrdered: Prisma.Decimal; expectedPrice: Prisma.Decimal | null; actualPrice: Prisma.Decimal | null };
type MoneyRow = { amount: Prisma.Decimal | null; currency: string };
type TimestampedRow = { createdAt: Date };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/**
 * Finance module (2026-08-24) — PO documents / expenses / payments and the
 * six-metric summary. Design confirmed in chat: goods cost always comes
 * from PurchaseOrderItem (never duplicated as an Expense row); actual cost
 * = goods + expenses; "unpaid per documents" (totalDocuments - paid) is a
 * deliberately DIFFERENT number from (actualCost - paid), since an expense
 * can exist before its confirming document/invoice ever arrives — see
 * PurchaseOrderFinanceSummary's own field comments.
 *
 * No FX conversion anywhere (audit confirmed none exists in this schema at
 * all) — sums are only ever computed within one currency; anything else is
 * surfaced as its own `otherCurrencies` bucket, never blended in.
 */
@Injectable()
export class FinanceService {
  private readonly primaryCurrency = 'EUR';

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------

  async getSummary(user: RequestUser, purchaseOrderId: string): Promise<PurchaseOrderFinanceSummary> {
    const order = await this.findOrderWithItemsOrThrow(purchaseOrderId);
    const [documents, expenses, payments] = await Promise.all([
      this.prisma.tenant.purchaseOrderDocument.findMany({ where: { purchaseOrderId } }),
      this.prisma.tenant.purchaseOrderExpense.findMany({ where: { purchaseOrderId } }),
      this.prisma.tenant.purchaseOrderPayment.findMany({ where: { document: { purchaseOrderId } } }),
    ]);
    return this.buildSummary(purchaseOrderId, order.items, documents, expenses, payments);
  }

  /**
   * PO list for the `/finance` landing page. Filters by a computed
   * paymentStatus can't be pushed into the DB query (it's derived from
   * three related tables' sums), so this fetches a superset and
   * filters/paginates in memory — acceptable for the per-company PO volume
   * this app targets (tens/hundreds), flagged as a scaling limit rather
   * than solved here (see the accompanying implementation report).
   */
  async listPurchaseOrdersWithSummary(user: RequestUser, query: QueryFinancePurchaseOrdersDto) {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.search) where.supplierNameSnapshot = { contains: query.search, mode: 'insensitive' };
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.dateFrom || query.dateTo) {
      where.orderDate = {
        ...(query.dateFrom ? { gte: query.dateFrom } : {}),
        ...(query.dateTo ? { lte: query.dateTo } : {}),
      };
    }

    const orders = await this.prisma.tenant.purchaseOrder.findMany({
      where,
      orderBy: { orderDate: 'desc' },
      include: { items: { select: { qtyOrdered: true, expectedPrice: true, actualPrice: true } } },
    });
    const orderIds = orders.map((o) => o.id);

    const [documents, expenses, payments] = await Promise.all([
      this.prisma.tenant.purchaseOrderDocument.findMany({ where: { purchaseOrderId: { in: orderIds } } }),
      this.prisma.tenant.purchaseOrderExpense.findMany({ where: { purchaseOrderId: { in: orderIds } } }),
      this.prisma.tenant.purchaseOrderPayment.findMany({
        where: { document: { purchaseOrderId: { in: orderIds } } },
        include: { document: { select: { purchaseOrderId: true } } },
      }),
    ]);

    const documentsByOrder = groupBy(documents, (d) => d.purchaseOrderId);
    const expensesByOrder = groupBy(expenses, (e) => e.purchaseOrderId);
    const paymentsByOrder = groupBy(payments, (p) => p.document.purchaseOrderId);

    let rows = orders.map((order) => {
      const summary = this.buildSummary(
        order.id,
        order.items,
        documentsByOrder.get(order.id) ?? [],
        expensesByOrder.get(order.id) ?? [],
        paymentsByOrder.get(order.id) ?? [],
      );
      return {
        purchaseOrder: {
          id: order.id,
          supplierNameSnapshot: order.supplierNameSnapshot,
          supplierId: order.supplierId,
          status: order.status,
          orderDate: order.orderDate,
        },
        summary,
        paymentStatus: this.poPaymentStatus(summary),
      };
    });

    if (query.paymentStatus) rows = rows.filter((r) => r.paymentStatus === query.paymentStatus);

    const total = rows.length;
    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    return { items: rows.slice(skip, skip + take), total, limit: take, offset: skip };
  }

  private buildSummary(
    purchaseOrderId: string,
    items: PoItemForCost[],
    documents: (MoneyRow & TimestampedRow)[],
    expenses: (MoneyRow & TimestampedRow)[],
    payments: (MoneyRow & TimestampedRow)[],
  ): PurchaseOrderFinanceSummary {
    const goodsCost = items.reduce((sum, item) => {
      const price = item.actualPrice ?? item.expectedPrice;
      return price === null ? sum : sum + Number(price) * Number(item.qtyOrdered);
    }, 0);

    const expensesByCurrency = this.sumByCurrency(expenses);
    const documentsByCurrency = this.sumByCurrency(documents.filter((d) => d.amount !== null));
    const paymentsByCurrency = this.sumByCurrency(payments);

    const currencies = new Set<string>([this.primaryCurrency, ...expensesByCurrency.keys(), ...documentsByCurrency.keys(), ...paymentsByCurrency.keys()]);

    const buckets = new Map<string, FinanceCurrencyBucket>();
    for (const currency of currencies) {
      const additionalExpenses = expensesByCurrency.get(currency) ?? 0;
      const totalDocuments = documentsByCurrency.get(currency) ?? 0;
      const paid = paymentsByCurrency.get(currency) ?? 0;
      buckets.set(currency, {
        currency,
        additionalExpenses: round2(additionalExpenses),
        totalDocuments: round2(totalDocuments),
        paid: round2(paid),
        unpaidPerDocuments: round2(totalDocuments - paid),
      });
    }

    const primary = buckets.get(this.primaryCurrency)!;
    const otherCurrencies = [...buckets.values()].filter((b) => b.currency !== this.primaryCurrency);

    const lastActivityAt = [...documents, ...expenses, ...payments]
      .map((r) => r.createdAt)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      purchaseOrderId,
      primaryCurrency: this.primaryCurrency,
      goodsCost: round2(goodsCost),
      additionalExpenses: primary.additionalExpenses,
      actualCost: round2(goodsCost + primary.additionalExpenses),
      totalDocuments: primary.totalDocuments,
      paid: primary.paid,
      unpaidPerDocuments: primary.unpaidPerDocuments,
      documentCount: documents.length,
      lastActivityAt,
      otherCurrencies,
    };
  }

  private sumByCurrency(rows: MoneyRow[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.amount === null) continue;
      map.set(row.currency, (map.get(row.currency) ?? 0) + Number(row.amount));
    }
    return map;
  }

  private poPaymentStatus(summary: PurchaseOrderFinanceSummary): FinancePaymentStatus {
    if (summary.totalDocuments <= 0 || summary.paid <= 0) return 'UNPAID';
    if (summary.paid >= summary.totalDocuments) return 'PAID';
    return 'PARTIAL';
  }

  private documentPaymentStatus(document: MoneyRow, payments: { amount: Prisma.Decimal; currency: string }[]): DocumentPaymentStatus {
    if (document.amount === null) return 'NO_AMOUNT';
    const paidSameCurrency = payments.filter((p) => p.currency === document.currency).reduce((sum, p) => sum + Number(p.amount), 0);
    if (paidSameCurrency <= 0) return 'UNPAID';
    if (paidSameCurrency >= Number(document.amount)) return 'PAID';
    return 'PARTIAL';
  }

  // ---------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------

  async listDocuments(user: RequestUser, purchaseOrderId: string) {
    await this.findOrderWithItemsOrThrow(purchaseOrderId);
    const documents = await this.prisma.tenant.purchaseOrderDocument.findMany({
      where: { purchaseOrderId },
      include: { counterparty: { select: { id: true, name: true } }, payments: true },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((d) => ({ ...d, paymentStatus: this.documentPaymentStatus(d, d.payments) }));
  }

  async createDocument(user: RequestUser, purchaseOrderId: string, dto: CreatePurchaseOrderDocumentDto) {
    await this.findOrderWithItemsOrThrow(purchaseOrderId);
    await this.assertSupplierExists(dto.counterpartyId);

    const document = await this.prisma.tenant.purchaseOrderDocument.create({
      data: {
        companyId: user.companyId,
        purchaseOrderId,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber,
        documentDate: dto.documentDate,
        counterpartyId: dto.counterpartyId,
        amount: dto.amount,
        currency: dto.currency ?? 'EUR',
        note: dto.note,
        createdById: user.userId,
      },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_document.created',
      entityType: 'PurchaseOrderDocument',
      entityId: document.id,
      after: document,
      metadata: { purchaseOrderId },
    });
    return document;
  }

  async getDocument(user: RequestUser, documentId: string) {
    const document = await this.getDocumentWithPaymentsOrThrow(documentId);
    return { ...document, paymentStatus: this.documentPaymentStatus(document, document.payments) };
  }

  async updateDocument(user: RequestUser, documentId: string, dto: UpdatePurchaseOrderDocumentDto) {
    const before = await this.getDocumentWithPaymentsOrThrow(documentId);
    if (dto.counterpartyId) await this.assertSupplierExists(dto.counterpartyId);
    if (dto.amount === null && before.payments.length > 0) {
      throw new CodedBadRequestException('FINANCE_DOCUMENT_HAS_PAYMENTS', 'Cannot clear the amount — this document already has recorded payments.');
    }

    const document = await this.prisma.tenant.purchaseOrderDocument.update({
      where: { id: documentId },
      data: {
        ...(dto.documentType !== undefined ? { documentType: dto.documentType } : {}),
        ...(dto.documentNumber !== undefined ? { documentNumber: dto.documentNumber } : {}),
        ...(dto.documentDate !== undefined ? { documentDate: dto.documentDate } : {}),
        ...(dto.counterpartyId !== undefined ? { counterpartyId: dto.counterpartyId } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_document.updated',
      entityType: 'PurchaseOrderDocument',
      entityId: documentId,
      before,
      after: document,
    });
    return document;
  }

  async deleteDocument(user: RequestUser, documentId: string) {
    const document = await this.getDocumentWithPaymentsOrThrow(documentId);
    // DB-level cascade: purchase_order_payments -> ON DELETE CASCADE,
    // purchase_order_expenses.documentId -> ON DELETE SET NULL (an expense
    // survives losing its confirming document; it just becomes
    // "not yet documented" again, same as before the link was made).
    await this.prisma.tenant.purchaseOrderDocument.delete({ where: { id: documentId } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_document.deleted',
      entityType: 'PurchaseOrderDocument',
      entityId: documentId,
      before: document,
    });
  }

  // ---------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------

  /**
   * Point 8/9 of the confirmed design: a Document with amount=null can
   * never receive a Payment, and a Payment can never exceed the document's
   * remaining balance — but that overpayment check only applies when the
   * payment's own currency matches the document's (point 7: never blend
   * different currencies into one comparison). A mismatched-currency
   * payment is still recorded (MVP does no conversion) with
   * `currencyMismatch: true` on the response so the UI can flag it.
   */
  async addPayment(user: RequestUser, documentId: string, dto: CreatePurchaseOrderPaymentDto) {
    const document = await this.getDocumentWithPaymentsOrThrow(documentId);
    if (document.amount === null) {
      throw new CodedBadRequestException('FINANCE_DOCUMENT_NO_AMOUNT', 'This document has no amount and cannot receive payments.');
    }

    const currency = dto.currency ?? document.currency;
    if (currency === document.currency) {
      const alreadyPaid = document.payments
        .filter((p) => p.currency === document.currency)
        .reduce((sum, p) => sum + Number(p.amount), 0);
      const remaining = Number(document.amount) - alreadyPaid;
      if (dto.amount > remaining + 0.005) {
        throw new CodedBadRequestException(
          'FINANCE_PAYMENT_EXCEEDS_REMAINING',
          `Payment of ${dto.amount} ${currency} exceeds the remaining balance of ${round2(Math.max(remaining, 0))} ${currency}.`,
        );
      }
    }

    const payment = await this.prisma.tenant.purchaseOrderPayment.create({
      data: {
        companyId: user.companyId,
        documentId,
        amount: dto.amount,
        currency,
        paidAt: dto.paidAt,
        method: dto.method,
        note: dto.note,
        createdById: user.userId,
      },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_payment.created',
      entityType: 'PurchaseOrderPayment',
      entityId: payment.id,
      after: payment,
      metadata: { documentId },
    });

    return { ...payment, currencyMismatch: currency !== document.currency };
  }

  async deletePayment(user: RequestUser, paymentId: string) {
    const payment = await this.prisma.tenant.purchaseOrderPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new CodedNotFoundException('FINANCE_PAYMENT_NOT_FOUND', 'Payment not found.');
    await this.prisma.tenant.purchaseOrderPayment.delete({ where: { id: paymentId } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_payment.deleted',
      entityType: 'PurchaseOrderPayment',
      entityId: paymentId,
      before: payment,
    });
  }

  // ---------------------------------------------------------------------
  // Expenses
  // ---------------------------------------------------------------------

  async listExpenses(user: RequestUser, purchaseOrderId: string) {
    await this.findOrderWithItemsOrThrow(purchaseOrderId);
    return this.prisma.tenant.purchaseOrderExpense.findMany({ where: { purchaseOrderId }, orderBy: { createdAt: 'desc' } });
  }

  async createExpense(user: RequestUser, purchaseOrderId: string, dto: CreatePurchaseOrderExpenseDto) {
    await this.findOrderWithItemsOrThrow(purchaseOrderId);
    if (dto.documentId) await this.assertDocumentBelongsToOrder(dto.documentId, purchaseOrderId);

    const expense = await this.prisma.tenant.purchaseOrderExpense.create({
      data: {
        companyId: user.companyId,
        purchaseOrderId,
        category: dto.category,
        amount: dto.amount,
        currency: dto.currency ?? 'EUR',
        description: dto.description,
        documentId: dto.documentId,
        createdById: user.userId,
      },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_expense.created',
      entityType: 'PurchaseOrderExpense',
      entityId: expense.id,
      after: expense,
      metadata: { purchaseOrderId },
    });
    return expense;
  }

  async updateExpense(user: RequestUser, expenseId: string, dto: UpdatePurchaseOrderExpenseDto) {
    const before = await this.getExpenseOrThrow(expenseId);
    if (dto.documentId) await this.assertDocumentBelongsToOrder(dto.documentId, before.purchaseOrderId);

    const expense = await this.prisma.tenant.purchaseOrderExpense.update({
      where: { id: expenseId },
      data: {
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.documentId !== undefined ? { documentId: dto.documentId } : {}),
      },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_expense.updated',
      entityType: 'PurchaseOrderExpense',
      entityId: expenseId,
      before,
      after: expense,
    });
    return expense;
  }

  async deleteExpense(user: RequestUser, expenseId: string) {
    const expense = await this.getExpenseOrThrow(expenseId);
    await this.prisma.tenant.purchaseOrderExpense.delete({ where: { id: expenseId } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_expense.deleted',
      entityType: 'PurchaseOrderExpense',
      entityId: expenseId,
      before: expense,
    });
  }

  // ---------------------------------------------------------------------
  // Shared lookups / ownership-chain checks
  // ---------------------------------------------------------------------

  private async findOrderWithItemsOrThrow(purchaseOrderId: string) {
    const order = await this.prisma.tenant.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { items: { select: { qtyOrdered: true, expectedPrice: true, actualPrice: true } } },
    });
    if (!order) throw new CodedNotFoundException('PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.');
    return order;
  }

  private async getDocumentWithPaymentsOrThrow(documentId: string) {
    const document = await this.prisma.tenant.purchaseOrderDocument.findUnique({
      where: { id: documentId },
      include: { counterparty: { select: { id: true, name: true } }, payments: { orderBy: { paidAt: 'asc' } } },
    });
    if (!document) throw new CodedNotFoundException('FINANCE_DOCUMENT_NOT_FOUND', 'Document not found.');
    return document;
  }

  private async getExpenseOrThrow(expenseId: string) {
    const expense = await this.prisma.tenant.purchaseOrderExpense.findUnique({ where: { id: expenseId } });
    if (!expense) throw new CodedNotFoundException('FINANCE_EXPENSE_NOT_FOUND', 'Expense not found.');
    return expense;
  }

  private async assertSupplierExists(supplierId: string) {
    const supplier = await this.prisma.tenant.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new CodedNotFoundException('SUPPLIER_NOT_FOUND', 'Counterparty supplier not found.');
  }

  /** RLS already keeps this within the company; this closes the rest of the ownership chain — same "404 for cross-order, not just cross-tenant" convention as PurchaseOrdersService#findScheduleForOrder. */
  private async assertDocumentBelongsToOrder(documentId: string, purchaseOrderId: string) {
    const document = await this.prisma.tenant.purchaseOrderDocument.findUnique({ where: { id: documentId } });
    if (!document || document.purchaseOrderId !== purchaseOrderId) {
      throw new CodedNotFoundException('FINANCE_DOCUMENT_NOT_FOUND', 'Document not found on this purchase order.');
    }
  }
}
