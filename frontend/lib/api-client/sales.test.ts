import {
  giveItemToProduction,
  giveAllToProduction,
  getShortagePreview,
  createPurchaseOrdersFromShortage,
  createShipment,
  deleteShipment,
  markShipmentDelivered,
  cancelCustomerOrder,
} from './sales';
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

describe('giveItemToProduction', () => {
  it('posts to customer-orders/:id/items/:itemId/give-to-production, defaulting to an empty body', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ item: {}, productionOrder: { id: 'po1' } });
    await giveItemToProduction('co1', 'item1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('customer-orders/co1/items/item1/give-to-production', {});
  });

  it('forwards an explicit unitsPlanned override', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ item: {}, productionOrder: { id: 'po1' } });
    await giveItemToProduction('co1', 'item1', { unitsPlanned: 12 });
    expect(mockedApiClient.post).toHaveBeenCalledWith('customer-orders/co1/items/item1/give-to-production', { unitsPlanned: 12 });
  });
});

describe('giveAllToProduction', () => {
  it('posts to customer-orders/:id/give-all-to-production with no body', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue([]);
    await giveAllToProduction('co1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('customer-orders/co1/give-all-to-production');
  });
});

describe('getShortagePreview', () => {
  it('is a GET, not a POST — the preview never mutates anything', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ orderId: 'co1', groups: [] });
    await getShortagePreview('co1');
    expect(mockedApiClient.get).toHaveBeenCalledWith('customer-orders/co1/shortage-preview');
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });
});

describe('createPurchaseOrdersFromShortage', () => {
  it('posts the groups array wrapped in {groups}', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue([]);
    const groups = [{ supplierName: 'Acme', items: [{ kind: 'PRODUCT' as const, description: 'Widget', qty: 5 }] }];
    await createPurchaseOrdersFromShortage('co1', groups);
    expect(mockedApiClient.post).toHaveBeenCalledWith('customer-orders/co1/purchase-orders-from-shortage', { groups });
  });
});

describe('createShipment', () => {
  it('posts the full CreateShipmentDto shape, including finishedGoodIds', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'sh1' });
    await createShipment({ finishedGoodIds: ['fg1', 'fg2'], carrier: 'DHL' });
    expect(mockedApiClient.post).toHaveBeenCalledWith('shipments', { finishedGoodIds: ['fg1', 'fg2'], carrier: 'DHL' });
  });
});

describe('markShipmentDelivered', () => {
  it('posts to shipments/:id/deliver with no body', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'sh1', status: 'DELIVERED' });
    await markShipmentDelivered('sh1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('shipments/sh1/deliver');
  });
});

describe('deleteShipment', () => {
  it('is a real DELETE, restricted server-side to not-yet-delivered shipments', async () => {
    (mockedApiClient.delete as jest.Mock).mockResolvedValue({ ok: true });
    await deleteShipment('sh1');
    expect(mockedApiClient.delete).toHaveBeenCalledWith('shipments/sh1');
  });
});

describe('cancelCustomerOrder', () => {
  it('posts to customer-orders/:id/cancel with no body', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'co1', status: 'CANCELLED' });
    await cancelCustomerOrder('co1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('customer-orders/co1/cancel');
  });
});
