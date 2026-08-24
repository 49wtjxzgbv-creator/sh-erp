import {
  listFinancePurchaseOrders,
  getPurchaseOrderFinanceSummary,
  createPurchaseOrderDocument,
  addFinancePayment,
  createPurchaseOrderExpense,
  listFinanceCustomerOrders,
  getCustomerOrderFinanceSummary,
  createCustomerOrderDocument,
  addFinanceCustomerOrderPayment,
  createCustomerOrderExpense,
} from './finance';
import { apiClient } from './http';

jest.mock('./http', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

afterEach(() => jest.resetAllMocks());

describe('listFinancePurchaseOrders', () => {
  it('gets finance/purchase-orders with filters as query params', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    await listFinancePurchaseOrders({ search: 'ABC', paymentStatus: 'PARTIAL' });
    expect(mockedApiClient.get).toHaveBeenCalledWith('finance/purchase-orders', { query: { search: 'ABC', paymentStatus: 'PARTIAL' } });
  });
});

describe('getPurchaseOrderFinanceSummary', () => {
  it('gets the six-metric summary for one PO', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({});
    await getPurchaseOrderFinanceSummary('po1');
    expect(mockedApiClient.get).toHaveBeenCalledWith('finance/purchase-orders/po1/summary');
  });
});

describe('createPurchaseOrderDocument', () => {
  it('posts the CreatePurchaseOrderDocumentDto shape, including an amount-less document', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'doc1' });
    await createPurchaseOrderDocument('po1', { documentType: 'PACKING_LIST', counterpartyId: 's1' });
    expect(mockedApiClient.post).toHaveBeenCalledWith('finance/purchase-orders/po1/documents', {
      documentType: 'PACKING_LIST',
      counterpartyId: 's1',
    });
  });
});

describe('addFinancePayment', () => {
  it('posts to finance/documents/:id/payments', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'pay1' });
    await addFinancePayment('doc1', { amount: 2000, paidAt: '2026-08-20' });
    expect(mockedApiClient.post).toHaveBeenCalledWith('finance/documents/doc1/payments', { amount: 2000, paidAt: '2026-08-20' });
  });
});

describe('createPurchaseOrderExpense', () => {
  it('posts the CreatePurchaseOrderExpenseDto shape with an optional documentId link', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'exp1' });
    await createPurchaseOrderExpense('po1', { category: 'SHIPPING', amount: 180, documentId: 'doc-dhl' });
    expect(mockedApiClient.post).toHaveBeenCalledWith('finance/purchase-orders/po1/expenses', {
      category: 'SHIPPING',
      amount: 180,
      documentId: 'doc-dhl',
    });
  });
});

describe('listFinanceCustomerOrders', () => {
  it('gets finance/customer-orders with filters as query params', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    await listFinanceCustomerOrders({ search: 'Ромашка', paymentStatus: 'PARTIAL' });
    expect(mockedApiClient.get).toHaveBeenCalledWith('finance/customer-orders', { query: { search: 'Ромашка', paymentStatus: 'PARTIAL' } });
  });
});

describe('getCustomerOrderFinanceSummary', () => {
  it('gets the rolled-up summary for one customer order', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({});
    await getCustomerOrderFinanceSummary('co1');
    expect(mockedApiClient.get).toHaveBeenCalledWith('finance/customer-orders/co1/summary');
  });
});

describe('createCustomerOrderDocument', () => {
  it('posts to finance/customer-orders/:id/documents', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'cod1' });
    await createCustomerOrderDocument('co1', { documentType: 'INVOICE', counterpartyId: 's1', amount: 50 });
    expect(mockedApiClient.post).toHaveBeenCalledWith('finance/customer-orders/co1/documents', {
      documentType: 'INVOICE',
      counterpartyId: 's1',
      amount: 50,
    });
  });
});

describe('addFinanceCustomerOrderPayment', () => {
  it('posts to finance/customer-order-documents/:id/payments (distinct route namespace from the PO side)', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'p1' });
    await addFinanceCustomerOrderPayment('cod1', { amount: 100, paidAt: '2026-08-24' });
    expect(mockedApiClient.post).toHaveBeenCalledWith('finance/customer-order-documents/cod1/payments', { amount: 100, paidAt: '2026-08-24' });
  });
});

describe('createCustomerOrderExpense', () => {
  it('posts to finance/customer-orders/:id/expenses', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'exp1' });
    await createCustomerOrderExpense('co1', { category: 'OTHER', amount: 50 });
    expect(mockedApiClient.post).toHaveBeenCalledWith('finance/customer-orders/co1/expenses', { category: 'OTHER', amount: 50 });
  });
});
