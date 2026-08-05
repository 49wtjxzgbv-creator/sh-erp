import { uploadFile } from './files';
import { apiClient } from './http';

jest.mock('./http', () => ({
  apiClient: {
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('uploadFile', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.resetAllMocks();
    global.fetch = originalFetch;
  });

  it('presigns, PUTs directly to the returned URL, then confirms — in that order', async () => {
    const file = new File(['hello'], 'logo.png', { type: 'image/png' });

    (mockedApiClient.post as jest.Mock).mockImplementation((path: string) => {
      if (path === 'files/presigned-upload') {
        return Promise.resolve({ fileAssetId: 'asset-1', uploadUrl: 'https://r2.example/put', expiresInSeconds: 300 });
      }
      if (path === 'files/asset-1/confirm') {
        return Promise.resolve({ id: 'asset-1', originalName: 'logo.png' });
      }
      throw new Error(`unexpected path ${path}`);
    });

    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await uploadFile(file, { domain: 'BRANDING', entityType: 'Company', entityId: 'company-1' });

    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'files/presigned-upload',
      expect.objectContaining({ domain: 'BRANDING', entityType: 'Company', entityId: 'company-1', originalName: 'logo.png' }),
    );
    expect(fetchMock).toHaveBeenCalledWith('https://r2.example/put', expect.objectContaining({ method: 'PUT' }));
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(2, 'files/asset-1/confirm');
    expect(result).toEqual({ id: 'asset-1', originalName: 'logo.png' });
  });

  it('throws and does not call confirm if the direct-to-R2 PUT fails', async () => {
    const file = new File(['hello'], 'logo.png', { type: 'image/png' });
    (mockedApiClient.post as jest.Mock).mockResolvedValueOnce({
      fileAssetId: 'asset-1',
      uploadUrl: 'https://r2.example/put',
      expiresInSeconds: 300,
    });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;

    await expect(
      uploadFile(file, { domain: 'BRANDING', entityType: 'Company', entityId: 'company-1' }),
    ).rejects.toThrow('403');
    expect(mockedApiClient.post).toHaveBeenCalledTimes(1);
  });
});
