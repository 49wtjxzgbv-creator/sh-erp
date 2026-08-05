import { createPurchaseOrder, receivePurchaseOrder, deleteSupplier, updateSupplier, querySuppliers } from './procurement';
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

describe('createPurchaseOrder', () => {
  it('posts the full CreatePurchaseOrderDto shape, including multi-line items', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'po1' });
    await createPurchaseOrder({
      supplierNameSnapshot: 'Acme Supplies',
      items: [{ articleSnapshot: 'A-1', productNameSnapshot: 'Widget', qtyOrdered: 10 }],
    });
    expect(mockedApiClient.post).toHaveBeenCalledWith('purchase-orders', {
      supplierNameSnapshot: 'Acme Supplies',
      items: [{ articleSnapshot: 'A-1', productNameSnapshot: 'Widget', qtyOrdered: 10 }],
    });
  });
});

describe('receivePurchaseOrder', () => {
  it('posts to purchase-orders/:id/receive with the warehouseId/lines shape', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'po1', status: 'PARTIAL' });
    await receivePurchaseOrder('po1', { warehouseId: 'w1', lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 5 }] });
    expect(mockedApiClient.post).toHaveBeenCalledWith('purchase-orders/po1/receive', {
      warehouseId: 'w1',
      lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 5 }],
    });
  });
});

describe('deleteSupplier', () => {
  it('is a soft-delete with no in-use guard — DELETE with no confirmation body', async () => {
    (mockedApiClient.delete as jest.Mock).mockResolvedValue({ ok: true });
    await deleteSupplier('s1');
    expect(mockedApiClient.delete).toHaveBeenCalledWith('suppliers/s1');
  });
});

describe('updateSupplier', () => {
  it('PATCHes a partial payload, not PUT', async () => {
    (mockedApiClient.patch as jest.Mock).mockResolvedValue({ id: 's1' });
    await updateSupplier('s1', { phone: '+1-555-0100' });
    expect(mockedApiClient.patch).toHaveBeenCalledWith('suppliers/s1', { phone: '+1-555-0100' });
    expect(mockedApiClient.put).not.toHaveBeenCalled();
  });
});

describe('querySuppliers', () => {
  it('is a GET, not a POST — searching suppliers has no side effects', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    await querySuppliers({ search: 'Acme' });
    expect(mockedApiClient.get).toHaveBeenCalledWith('suppliers', { query: { search: 'Acme' } });
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });
});
