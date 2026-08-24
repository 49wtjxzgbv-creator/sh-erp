import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePurchaseOrderDocumentDto, QueryFinancePurchaseOrdersDto, UpdatePurchaseOrderDocumentDto } from './dto/finance-document.dto';
import { CreatePurchaseOrderPaymentDto, UpdatePurchaseOrderPaymentDto } from './dto/finance-payment.dto';
import { CreatePurchaseOrderExpenseDto, UpdatePurchaseOrderExpenseDto } from './dto/finance-expense.dto';
import { CreateCustomerOrderDocumentDto, QueryFinanceCustomerOrdersDto, UpdateCustomerOrderDocumentDto } from './dto/finance-customer-order-document.dto';
import { CreateCustomerOrderExpenseDto, UpdateCustomerOrderExpenseDto } from './dto/finance-customer-order-expense.dto';

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

export interface CustomerOrderPurchaseOrderRollup {
  purchaseOrder: { id: string; supplierNameSnapshot: string; status: string; orderDate: Date };
  summary: PurchaseOrderFinanceSummary;
}

export interface CustomerOrderFinanceSummary {
  customerOrderId: string;
  primaryCurrency: string;
  // Cost rolled up automatically from every linked PurchaseOrder
  // (PurchaseOrder.sourceCustomerOrderId) — never re-entered manually, see
  // CustomerOrderDocument's schema.prisma comment for the double-counting
  // discipline this preserves.
  purchaseCost: number;
  // Direct cost documents/expenses on THIS order only (not tied to any
  // specific purchase — packaging, delivery to the client, etc).
  additionalExpenses: number;
  actualCost: number; // purchaseCost + additionalExpenses
  totalDocuments: number; // Σ linked-PO totalDocuments + Σ direct document amounts
  paid: number;
  unpaidPerDocuments: number;
  documentCount: number;
  lastActivityAt: Date | null;
  otherCurrencies: FinanceCurrencyBucket[];
  purchaseOrders: CustomerOrderPurchaseOrderRollup[];
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

interface CurrencyContribution {
  currency: string;
  additionalExpenses: number;
  totalDocuments: number;
  paid: number;
}

/** Sums several sources' per-currency contributions (e.g. a CustomerOrder's own direct documents plus every linked PurchaseOrder's own currency buckets) into one final set of buckets — same "never blend different currencies" discipline as buildSummary, just merging multiple already-currency-separated sources instead of raw rows. */
function mergeCurrencyContributions(contributions: CurrencyContribution[]): FinanceCurrencyBucket[] {
  const map = new Map<string, { additionalExpenses: number; totalDocuments: number; paid: number }>();
  for (const c of contributions) {
    const bucket = map.get(c.currency) ?? { additionalExpenses: 0, totalDocuments: 0, paid: 0 };
    bucket.additionalExpenses += c.additionalExpenses;
    bucket.totalDocuments += c.totalDocuments;
    bucket.paid += c.paid;
    map.set(c.currency, bucket);
  }
  return [...map.entries()].map(([currency, v]) => ({
    currency,
    additionalExpenses: round2(v.additionalExpenses),
    totalDocuments: round2(v.totalDocuments),
    paid: round2(v.paid),
    unpaidPerDocuments: round2(v.totalDocuments - v.paid),
  }));
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

  private poPaymentStatus(summary: { totalDocuments: number; paid: number }): FinancePaymentStatus {
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

  /** Same remaining-balance rule as addPayment, but the payment being edited is excluded from its own "already paid" sum. */
  async updatePayment(user: RequestUser, paymentId: string, dto: UpdatePurchaseOrderPaymentDto) {
    const existing = await this.prisma.tenant.purchaseOrderPayment.findUnique({ where: { id: paymentId } });
    if (!existing) throw new CodedNotFoundException('FINANCE_PAYMENT_NOT_FOUND', 'Payment not found.');
    const document = await this.getDocumentWithPaymentsOrThrow(existing.documentId);

    const amount = dto.amount ?? Number(existing.amount);
    const currency = dto.currency ?? existing.currency;
    if (document.amount !== null && currency === document.currency) {
      const alreadyPaid = document.payments
        .filter((p) => p.id !== paymentId && p.currency === document.currency)
        .reduce((sum, p) => sum + Number(p.amount), 0);
      const remaining = Number(document.amount) - alreadyPaid;
      if (amount > remaining + 0.005) {
        throw new CodedBadRequestException(
          'FINANCE_PAYMENT_EXCEEDS_REMAINING',
          `Payment of ${amount} ${currency} exceeds the remaining balance of ${round2(Math.max(remaining, 0))} ${currency}.`,
        );
      }
    }

    const payment = await this.prisma.tenant.purchaseOrderPayment.update({
      where: { id: paymentId },
      data: {
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.paidAt !== undefined ? { paidAt: dto.paidAt } : {}),
        ...(dto.method !== undefined ? { method: dto.method } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_payment.updated',
      entityType: 'PurchaseOrderPayment',
      entityId: paymentId,
      before: existing,
      after: payment,
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
  // CustomerOrder-Finance (2026-08-24) — same money model, one level up.
  // A CustomerOrder's real cost = automatic rollup of every linked
  // PurchaseOrder's own actualCost (sourceCustomerOrderId) + direct cost
  // documents/expenses recorded here. See CustomerOrderFinanceSummary's own
  // field comments and schema.prisma's CustomerOrderDocument comment for
  // the full rationale and the double-counting guard.
  // ---------------------------------------------------------------------

  async getCustomerOrderSummary(user: RequestUser, customerOrderId: string): Promise<CustomerOrderFinanceSummary> {
    await this.findCustomerOrderOrThrow(customerOrderId);

    const linkedPOs = await this.prisma.tenant.purchaseOrder.findMany({
      where: { sourceCustomerOrderId: customerOrderId },
      include: { items: { select: { qtyOrdered: true, expectedPrice: true, actualPrice: true } } },
      orderBy: { orderDate: 'desc' },
    });
    const poRollups = await this.buildPurchaseOrderRollups(linkedPOs);

    const [directDocuments, directExpenses, directPayments] = await Promise.all([
      this.prisma.tenant.customerOrderDocument.findMany({ where: { customerOrderId } }),
      this.prisma.tenant.customerOrderExpense.findMany({ where: { customerOrderId } }),
      this.prisma.tenant.customerOrderPayment.findMany({ where: { document: { customerOrderId } } }),
    ]);
    // Reuses buildSummary as-is with an empty `items` array — goodsCost is
    // always 0 for the "direct" part, so its additionalExpenses/actualCost
    // become exactly the direct-expenses total, with the same per-currency
    // separation buildSummary already guarantees.
    const directSummary = this.buildSummary(customerOrderId, [], directDocuments, directExpenses, directPayments);

    return this.mergeCustomerOrderSummary(customerOrderId, poRollups, directSummary, directDocuments.length);
  }

  /**
   * `/finance` landing page (Customer Orders tab) — same in-memory
   * filter/paginate tradeoff as listPurchaseOrdersWithSummary, same
   * rationale (paymentStatus is derived, can't be pushed into the DB query).
   */
  async listCustomerOrdersWithSummary(user: RequestUser, query: QueryFinanceCustomerOrdersDto) {
    const where: Prisma.CustomerOrderWhereInput = {};
    if (query.search) where.clientName = { contains: query.search, mode: 'insensitive' };

    const orders = await this.prisma.tenant.customerOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length === 0) {
      return { items: [], total: 0, limit: query.limit ?? 50, offset: query.offset ?? 0 };
    }

    const [linkedPOs, directDocuments, directExpenses, directPayments] = await Promise.all([
      this.prisma.tenant.purchaseOrder.findMany({
        where: { sourceCustomerOrderId: { in: orderIds } },
        include: { items: { select: { qtyOrdered: true, expectedPrice: true, actualPrice: true } } },
      }),
      this.prisma.tenant.customerOrderDocument.findMany({ where: { customerOrderId: { in: orderIds } } }),
      this.prisma.tenant.customerOrderExpense.findMany({ where: { customerOrderId: { in: orderIds } } }),
      this.prisma.tenant.customerOrderPayment.findMany({
        where: { document: { customerOrderId: { in: orderIds } } },
        include: { document: { select: { customerOrderId: true } } },
      }),
    ]);

    const poIds = linkedPOs.map((p) => p.id);
    const [poDocuments, poExpenses, poPayments] = await Promise.all([
      poIds.length ? this.prisma.tenant.purchaseOrderDocument.findMany({ where: { purchaseOrderId: { in: poIds } } }) : Promise.resolve([]),
      poIds.length ? this.prisma.tenant.purchaseOrderExpense.findMany({ where: { purchaseOrderId: { in: poIds } } }) : Promise.resolve([]),
      poIds.length
        ? this.prisma.tenant.purchaseOrderPayment.findMany({
            where: { document: { purchaseOrderId: { in: poIds } } },
            include: { document: { select: { purchaseOrderId: true } } },
          })
        : Promise.resolve([]),
    ]);
    const poDocsByPo = groupBy(poDocuments, (d) => d.purchaseOrderId);
    const poExpByPo = groupBy(poExpenses, (e) => e.purchaseOrderId);
    const poPayByPo = groupBy(poPayments, (p) => p.document.purchaseOrderId);
    const posByCustomerOrder = groupBy(linkedPOs, (p) => p.sourceCustomerOrderId as string);

    const directDocsByOrder = groupBy(directDocuments, (d) => d.customerOrderId);
    const directExpByOrder = groupBy(directExpenses, (e) => e.customerOrderId);
    const directPayByOrder = groupBy(directPayments, (p) => p.document.customerOrderId);

    let rows = orders.map((order) => {
      const pos = posByCustomerOrder.get(order.id) ?? [];
      const poRollups: CustomerOrderPurchaseOrderRollup[] = pos.map((po) => ({
        purchaseOrder: { id: po.id, supplierNameSnapshot: po.supplierNameSnapshot, status: po.status, orderDate: po.orderDate },
        summary: this.buildSummary(po.id, po.items, poDocsByPo.get(po.id) ?? [], poExpByPo.get(po.id) ?? [], poPayByPo.get(po.id) ?? []),
      }));
      const directDocs = directDocsByOrder.get(order.id) ?? [];
      const directSummary = this.buildSummary(order.id, [], directDocs, directExpByOrder.get(order.id) ?? [], directPayByOrder.get(order.id) ?? []);
      const summary = this.mergeCustomerOrderSummary(order.id, poRollups, directSummary, directDocs.length);

      return {
        customerOrder: { id: order.id, clientName: order.clientName, orderNumber: order.orderNumber, status: order.status, createdAt: order.createdAt },
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

  private async buildPurchaseOrderRollups(
    linkedPOs: Array<{ id: string; supplierNameSnapshot: string; status: string; orderDate: Date; items: PoItemForCost[] }>,
  ): Promise<CustomerOrderPurchaseOrderRollup[]> {
    const poIds = linkedPOs.map((p) => p.id);
    const [poDocuments, poExpenses, poPayments] = await Promise.all([
      poIds.length ? this.prisma.tenant.purchaseOrderDocument.findMany({ where: { purchaseOrderId: { in: poIds } } }) : Promise.resolve([]),
      poIds.length ? this.prisma.tenant.purchaseOrderExpense.findMany({ where: { purchaseOrderId: { in: poIds } } }) : Promise.resolve([]),
      poIds.length
        ? this.prisma.tenant.purchaseOrderPayment.findMany({
            where: { document: { purchaseOrderId: { in: poIds } } },
            include: { document: { select: { purchaseOrderId: true } } },
          })
        : Promise.resolve([]),
    ]);
    const docsByPo = groupBy(poDocuments, (d) => d.purchaseOrderId);
    const expByPo = groupBy(poExpenses, (e) => e.purchaseOrderId);
    const payByPo = groupBy(poPayments, (p) => p.document.purchaseOrderId);

    return linkedPOs.map((po) => ({
      purchaseOrder: { id: po.id, supplierNameSnapshot: po.supplierNameSnapshot, status: po.status, orderDate: po.orderDate },
      summary: this.buildSummary(po.id, po.items, docsByPo.get(po.id) ?? [], expByPo.get(po.id) ?? [], payByPo.get(po.id) ?? []),
    }));
  }

  /** Merges N linked-PO rollups + this order's own direct documents/expenses/payments into the final 6-metric CustomerOrderFinanceSummary — see that type's own field comments for what each number means and why they stay separate. */
  private mergeCustomerOrderSummary(
    customerOrderId: string,
    poRollups: CustomerOrderPurchaseOrderRollup[],
    directSummary: PurchaseOrderFinanceSummary,
    directDocumentCount: number,
  ): CustomerOrderFinanceSummary {
    const purchaseCost = poRollups.reduce((sum, p) => sum + p.summary.actualCost, 0);

    const contributions: CurrencyContribution[] = [
      { currency: this.primaryCurrency, additionalExpenses: directSummary.additionalExpenses, totalDocuments: directSummary.totalDocuments, paid: directSummary.paid },
      ...poRollups.map((p) => ({ currency: this.primaryCurrency, additionalExpenses: 0, totalDocuments: p.summary.totalDocuments, paid: p.summary.paid })),
      ...directSummary.otherCurrencies.map((b) => ({ currency: b.currency, additionalExpenses: b.additionalExpenses, totalDocuments: b.totalDocuments, paid: b.paid })),
      ...poRollups.flatMap((p) => p.summary.otherCurrencies.map((b) => ({ currency: b.currency, additionalExpenses: 0, totalDocuments: b.totalDocuments, paid: b.paid }))),
    ];
    const merged = mergeCurrencyContributions(contributions);
    const primary = merged.find((b) => b.currency === this.primaryCurrency) ?? {
      currency: this.primaryCurrency,
      additionalExpenses: 0,
      totalDocuments: 0,
      paid: 0,
      unpaidPerDocuments: 0,
    };
    const otherCurrencies = merged.filter((b) => b.currency !== this.primaryCurrency);

    const documentCount = directDocumentCount + poRollups.reduce((sum, p) => sum + p.summary.documentCount, 0);
    const lastActivityAt =
      [directSummary.lastActivityAt, ...poRollups.map((p) => p.summary.lastActivityAt)]
        .filter((d): d is Date => d !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      customerOrderId,
      primaryCurrency: this.primaryCurrency,
      purchaseCost: round2(purchaseCost),
      additionalExpenses: primary.additionalExpenses,
      actualCost: round2(purchaseCost + primary.additionalExpenses),
      totalDocuments: primary.totalDocuments,
      paid: primary.paid,
      unpaidPerDocuments: primary.unpaidPerDocuments,
      documentCount,
      lastActivityAt,
      otherCurrencies,
      purchaseOrders: poRollups,
    };
  }

  async listCustomerOrderDocuments(user: RequestUser, customerOrderId: string) {
    await this.findCustomerOrderOrThrow(customerOrderId);
    const documents = await this.prisma.tenant.customerOrderDocument.findMany({
      where: { customerOrderId },
      include: { counterparty: { select: { id: true, name: true } }, payments: true },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((d) => ({ ...d, paymentStatus: this.documentPaymentStatus(d, d.payments) }));
  }

  async createCustomerOrderDocument(user: RequestUser, customerOrderId: string, dto: CreateCustomerOrderDocumentDto) {
    await this.findCustomerOrderOrThrow(customerOrderId);
    await this.assertSupplierExists(dto.counterpartyId);

    const document = await this.prisma.tenant.customerOrderDocument.create({
      data: {
        companyId: user.companyId,
        customerOrderId,
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
      action: 'finance_customer_order_document.created',
      entityType: 'CustomerOrderDocument',
      entityId: document.id,
      after: document,
      metadata: { customerOrderId },
    });
    return document;
  }

  async getCustomerOrderDocument(user: RequestUser, documentId: string) {
    const document = await this.getCustomerOrderDocumentWithPaymentsOrThrow(documentId);
    return { ...document, paymentStatus: this.documentPaymentStatus(document, document.payments) };
  }

  async updateCustomerOrderDocument(user: RequestUser, documentId: string, dto: UpdateCustomerOrderDocumentDto) {
    const before = await this.getCustomerOrderDocumentWithPaymentsOrThrow(documentId);
    if (dto.counterpartyId) await this.assertSupplierExists(dto.counterpartyId);
    if (dto.amount === null && before.payments.length > 0) {
      throw new CodedBadRequestException('FINANCE_DOCUMENT_HAS_PAYMENTS', 'Cannot clear the amount — this document already has recorded payments.');
    }

    const document = await this.prisma.tenant.customerOrderDocument.update({
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
      action: 'finance_customer_order_document.updated',
      entityType: 'CustomerOrderDocument',
      entityId: documentId,
      before,
      after: document,
    });
    return document;
  }

  async deleteCustomerOrderDocument(user: RequestUser, documentId: string) {
    const document = await this.getCustomerOrderDocumentWithPaymentsOrThrow(documentId);
    await this.prisma.tenant.customerOrderDocument.delete({ where: { id: documentId } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_customer_order_document.deleted',
      entityType: 'CustomerOrderDocument',
      entityId: documentId,
      before: document,
    });
  }

  async addCustomerOrderPayment(user: RequestUser, documentId: string, dto: CreatePurchaseOrderPaymentDto) {
    const document = await this.getCustomerOrderDocumentWithPaymentsOrThrow(documentId);
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

    const payment = await this.prisma.tenant.customerOrderPayment.create({
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
      action: 'finance_customer_order_payment.created',
      entityType: 'CustomerOrderPayment',
      entityId: payment.id,
      after: payment,
      metadata: { documentId },
    });

    return { ...payment, currencyMismatch: currency !== document.currency };
  }

  /** Same remaining-balance rule as addCustomerOrderPayment, but the payment being edited is excluded from its own "already paid" sum. */
  async updateCustomerOrderPayment(user: RequestUser, paymentId: string, dto: UpdatePurchaseOrderPaymentDto) {
    const existing = await this.prisma.tenant.customerOrderPayment.findUnique({ where: { id: paymentId } });
    if (!existing) throw new CodedNotFoundException('FINANCE_PAYMENT_NOT_FOUND', 'Payment not found.');
    const document = await this.getCustomerOrderDocumentWithPaymentsOrThrow(existing.documentId);

    const amount = dto.amount ?? Number(existing.amount);
    const currency = dto.currency ?? existing.currency;
    if (document.amount !== null && currency === document.currency) {
      const alreadyPaid = document.payments
        .filter((p) => p.id !== paymentId && p.currency === document.currency)
        .reduce((sum, p) => sum + Number(p.amount), 0);
      const remaining = Number(document.amount) - alreadyPaid;
      if (amount > remaining + 0.005) {
        throw new CodedBadRequestException(
          'FINANCE_PAYMENT_EXCEEDS_REMAINING',
          `Payment of ${amount} ${currency} exceeds the remaining balance of ${round2(Math.max(remaining, 0))} ${currency}.`,
        );
      }
    }

    const payment = await this.prisma.tenant.customerOrderPayment.update({
      where: { id: paymentId },
      data: {
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.paidAt !== undefined ? { paidAt: dto.paidAt } : {}),
        ...(dto.method !== undefined ? { method: dto.method } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_customer_order_payment.updated',
      entityType: 'CustomerOrderPayment',
      entityId: paymentId,
      before: existing,
      after: payment,
    });

    return { ...payment, currencyMismatch: currency !== document.currency };
  }

  async deleteCustomerOrderPayment(user: RequestUser, paymentId: string) {
    const payment = await this.prisma.tenant.customerOrderPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new CodedNotFoundException('FINANCE_PAYMENT_NOT_FOUND', 'Payment not found.');
    await this.prisma.tenant.customerOrderPayment.delete({ where: { id: paymentId } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_customer_order_payment.deleted',
      entityType: 'CustomerOrderPayment',
      entityId: paymentId,
      before: payment,
    });
  }

  async listCustomerOrderExpenses(user: RequestUser, customerOrderId: string) {
    await this.findCustomerOrderOrThrow(customerOrderId);
    return this.prisma.tenant.customerOrderExpense.findMany({ where: { customerOrderId }, orderBy: { createdAt: 'desc' } });
  }

  async createCustomerOrderExpense(user: RequestUser, customerOrderId: string, dto: CreateCustomerOrderExpenseDto) {
    await this.findCustomerOrderOrThrow(customerOrderId);
    if (dto.documentId) await this.assertCustomerOrderDocumentBelongsToOrder(dto.documentId, customerOrderId);

    const expense = await this.prisma.tenant.customerOrderExpense.create({
      data: {
        companyId: user.companyId,
        customerOrderId,
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
      action: 'finance_customer_order_expense.created',
      entityType: 'CustomerOrderExpense',
      entityId: expense.id,
      after: expense,
      metadata: { customerOrderId },
    });
    return expense;
  }

  async updateCustomerOrderExpense(user: RequestUser, expenseId: string, dto: UpdateCustomerOrderExpenseDto) {
    const before = await this.getCustomerOrderExpenseOrThrow(expenseId);
    if (dto.documentId) await this.assertCustomerOrderDocumentBelongsToOrder(dto.documentId, before.customerOrderId);

    const expense = await this.prisma.tenant.customerOrderExpense.update({
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
      action: 'finance_customer_order_expense.updated',
      entityType: 'CustomerOrderExpense',
      entityId: expenseId,
      before,
      after: expense,
    });
    return expense;
  }

  async deleteCustomerOrderExpense(user: RequestUser, expenseId: string) {
    const expense = await this.getCustomerOrderExpenseOrThrow(expenseId);
    await this.prisma.tenant.customerOrderExpense.delete({ where: { id: expenseId } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'finance_customer_order_expense.deleted',
      entityType: 'CustomerOrderExpense',
      entityId: expenseId,
      before: expense,
    });
  }

  private async findCustomerOrderOrThrow(customerOrderId: string) {
    const order = await this.prisma.tenant.customerOrder.findUnique({ where: { id: customerOrderId } });
    if (!order) throw new CodedNotFoundException('CUSTOMER_ORDER_NOT_FOUND', 'Customer order not found.');
    return order;
  }

  private async getCustomerOrderDocumentWithPaymentsOrThrow(documentId: string) {
    const document = await this.prisma.tenant.customerOrderDocument.findUnique({
      where: { id: documentId },
      include: { counterparty: { select: { id: true, name: true } }, payments: { orderBy: { paidAt: 'asc' } } },
    });
    if (!document) throw new CodedNotFoundException('FINANCE_DOCUMENT_NOT_FOUND', 'Document not found.');
    return document;
  }

  private async getCustomerOrderExpenseOrThrow(expenseId: string) {
    const expense = await this.prisma.tenant.customerOrderExpense.findUnique({ where: { id: expenseId } });
    if (!expense) throw new CodedNotFoundException('FINANCE_EXPENSE_NOT_FOUND', 'Expense not found.');
    return expense;
  }

  private async assertCustomerOrderDocumentBelongsToOrder(documentId: string, customerOrderId: string) {
    const document = await this.prisma.tenant.customerOrderDocument.findUnique({ where: { id: documentId } });
    if (!document || document.customerOrderId !== customerOrderId) {
      throw new CodedNotFoundException('FINANCE_DOCUMENT_NOT_FOUND', 'Document not found on this customer order.');
    }
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
