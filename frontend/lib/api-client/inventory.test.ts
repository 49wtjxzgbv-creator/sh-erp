import {
  getStockLevels,
  getStockHistory,
  recordStockMovement,
  moveStock,
} from './inventory';
import { apiClient } from './http';

jest.mock('./http', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

afterEach(() => jest.resetAllMocks());

describe('getStockLevels', () => {
  it('omits undefined filters rather than sending them as literal "undefined"', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue([]);
    await getStockLevels({ warehouseId: 'w1' });
    expect(mockedApiClient.get).toHaveBeenCalledWith('stock/levels', { query: { warehouseId: 'w1' } });
  });
});

describe('getStockHistory', () => {
  it('passes pagination params through to the query string', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 100 });
    await getStockHistory({ productId: 'p1', limit: 50, offset: 100 });
    expect(mockedApiClient.get).toHaveBeenCalledWith('stock/movements', {
      query: { productId: 'p1', limit: 50, offset: 100 },
    });
  });
});

describe('recordStockMovement', () => {
  it('posts to stock/movements with the single-warehouse movement shape', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'm1' });
    await recordStockMovement({ productId: 'p1', warehouseId: 'w1', type: 'RECEIVE', qtyDelta: 5 });
    expect(mockedApiClient.post).toHaveBeenCalledWith('stock/movements', {
      productId: 'p1',
      warehouseId: 'w1',
      type: 'RECEIVE',
      qtyDelta: 5,
    });
  });
});

describe('moveStock', () => {
  it('posts to stock/move, not stock/movements — a move is a distinct backend endpoint, not a movement type client picks', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ correlationId: 'c1', out: {}, in: {} });
    await moveStock({ productId: 'p1', fromWarehouseId: 'w1', toWarehouseId: 'w2', qty: 3 });
    expect(mockedApiClient.post).toHaveBeenCalledWith('stock/move', {
      productId: 'p1',
      fromWarehouseId: 'w1',
      toWarehouseId: 'w2',
      qty: 3,
    });
  });
});
