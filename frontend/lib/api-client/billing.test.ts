import { listPlans, getSubscription, updateSubscription } from './billing';
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

describe('listPlans', () => {
  it('is an ungated GET — no permission required, unlike the subscription endpoints', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue([]);
    await listPlans();
    expect(mockedApiClient.get).toHaveBeenCalledWith('billing/plans');
  });
});

describe('getSubscription', () => {
  it('is a plain GET', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ companyId: 'c1' });
    await getSubscription();
    expect(mockedApiClient.get).toHaveBeenCalledWith('billing/subscription');
  });
});

describe('updateSubscription', () => {
  it('is a PUT with only planKey — a stub that records the change, never collects payment', async () => {
    (mockedApiClient.put as jest.Mock).mockResolvedValue({ companyId: 'c1', planId: 'p2' });
    await updateSubscription('growth');
    expect(mockedApiClient.put).toHaveBeenCalledWith('billing/subscription', { planKey: 'growth' });
  });
});
