import { previewLowStockDigest, sendLowStockDigestNow } from './notifications';
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

describe('previewLowStockDigest', () => {
  it('is a GET with no body — never sends anything', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ subject: 's', body: 'b', lowStockCount: 0, imminentForecastCount: 0 });
    await previewLowStockDigest();
    expect(mockedApiClient.get).toHaveBeenCalledWith('notifications/low-stock-digest/preview');
  });
});

describe('sendLowStockDigestNow', () => {
  it('posts with no body — an on-demand trigger, not a scheduled-send toggle', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ sent: true });
    await sendLowStockDigestNow();
    expect(mockedApiClient.post).toHaveBeenCalledWith('notifications/low-stock-digest/send-now');
  });
});
