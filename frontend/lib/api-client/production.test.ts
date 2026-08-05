import {
  setProductionOrderWorkers,
  startProductionOrder,
  cancelProductionOrder,
  advanceProductionOrderStage,
  reorderProductionStages,
  recordQcCheck,
  queryFinishedGoods,
} from './production';
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

describe('setProductionOrderWorkers', () => {
  it('PUTs to production-orders/:id/workers, wrapped in {workers} — PLANNED-only per backend contract', async () => {
    (mockedApiClient.put as jest.Mock).mockResolvedValue({ id: 'po1' });
    await setProductionOrderWorkers('po1', [{ employeeId: 'e1', percent: 100 }]);
    expect(mockedApiClient.put).toHaveBeenCalledWith('production-orders/po1/workers', {
      workers: [{ employeeId: 'e1', percent: 100 }],
    });
  });
});

describe('startProductionOrder', () => {
  it('posts to production-orders/:id/start with an optional warehouseId', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'po1', status: 'IN_PROGRESS' });
    await startProductionOrder('po1', { warehouseId: 'w1' });
    expect(mockedApiClient.post).toHaveBeenCalledWith('production-orders/po1/start', { warehouseId: 'w1' });
  });

  it('defaults to an empty body when no warehouseId is given', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'po1', status: 'IN_PROGRESS' });
    await startProductionOrder('po1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('production-orders/po1/start', {});
  });
});

describe('cancelProductionOrder', () => {
  it('posts to production-orders/:id/cancel with no body', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'po1', status: 'CANCELLED' });
    await cancelProductionOrder('po1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('production-orders/po1/cancel');
  });
});

describe('advanceProductionOrderStage', () => {
  it('posts to production-orders/:id/advance-stage with no body', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'po1', currentStageIndex: 1 });
    await advanceProductionOrderStage('po1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('production-orders/po1/advance-stage');
  });
});

describe('reorderProductionStages', () => {
  it('PUTs the full ordered id array — a full rewrite, not a partial patch', async () => {
    (mockedApiClient.put as jest.Mock).mockResolvedValue([]);
    await reorderProductionStages(['s2', 's1']);
    expect(mockedApiClient.put).toHaveBeenCalledWith('production-stages/reorder', { orderedIds: ['s2', 's1'] });
  });
});

describe('recordQcCheck', () => {
  it('posts the full RecordQcCheckDto shape to qc-checks', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'qc1', result: 'ACCEPTED' });
    await recordQcCheck({ finishedGoodId: 'fg1', result: 'ACCEPTED', results: [{ itemName: 'Visual check', passed: true }] });
    expect(mockedApiClient.post).toHaveBeenCalledWith('qc-checks', {
      finishedGoodId: 'fg1',
      result: 'ACCEPTED',
      results: [{ itemName: 'Visual check', passed: true }],
    });
  });
});

describe('queryFinishedGoods', () => {
  it('is a GET, not a POST — querying finished goods has no side effects', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    await queryFinishedGoods({ status: 'IN_STOCK' });
    expect(mockedApiClient.get).toHaveBeenCalledWith('finished-goods', { query: { status: 'IN_STOCK' } });
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });
});
