import { getReorderSuggestions, getWarehouseValuation, getMonthlyProductionRollup } from './reports';
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

describe('getReorderSuggestions', () => {
  it('is a GET with an optional limit — this module has no create/update/delete endpoints', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue([]);
    await getReorderSuggestions({ limit: 100 });
    expect(mockedApiClient.get).toHaveBeenCalledWith('reports/reorder-suggestions', { query: { limit: 100 } });
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });
});

describe('getWarehouseValuation', () => {
  it('is a GET with no query params — admin-only via reports:valuation, enforced server-side not client-side', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ byCategory: [], grandTotal: {} });
    await getWarehouseValuation();
    expect(mockedApiClient.get).toHaveBeenCalledWith('reports/warehouse-valuation');
  });
});

describe('getMonthlyProductionRollup', () => {
  it('forwards an optional from/to date range', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue([]);
    await getMonthlyProductionRollup({ from: '2026-08-01', to: '2026-08-31' });
    expect(mockedApiClient.get).toHaveBeenCalledWith('reports/monthly-production-rollup', {
      query: { from: '2026-08-01', to: '2026-08-31' },
    });
  });
});
