import { queryAuditEvents, getEntityAuditHistory } from './audit';
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

describe('queryAuditEvents', () => {
  it('GETs audit-events (not "audit" — matches the backend controller path exactly)', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    await queryAuditEvents({ entityType: 'ProductionOrder', limit: 50, offset: 0 });
    expect(mockedApiClient.get).toHaveBeenCalledWith('audit-events', {
      query: { entityType: 'ProductionOrder', limit: 50, offset: 0 },
    });
  });
});

describe('getEntityAuditHistory', () => {
  it('GETs audit-events/entity/:type/:id', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue([]);
    await getEntityAuditHistory('ProductionOrder', 'po-1');
    expect(mockedApiClient.get).toHaveBeenCalledWith('audit-events/entity/ProductionOrder/po-1');
  });
});
