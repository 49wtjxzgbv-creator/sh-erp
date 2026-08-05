import { apiClient } from './http';
import { useSessionStore } from '../auth/session-store';

describe('ApiClient.postFile / getBlob', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useSessionStore.getState().setSession({ accessToken: 'test-token', userId: 'u1', companyId: 'c1' });
  });

  afterEach(() => {
    jest.resetAllMocks();
    global.fetch = originalFetch;
    useSessionStore.getState().clearSession();
  });

  describe('postFile', () => {
    it('sends a real multipart FormData body with a Bearer header and no manual Content-Type (the browser sets the boundary itself)', async () => {
      const file = new File(['xlsx bytes'], 'products.xlsx');
      const fetchMock = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ created: 1, updated: 0, errors: [] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await apiClient.postFile('products/import', file);

      expect(result).toEqual({ created: 1, updated: 0, errors: [] });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('products/import');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer test-token');
      expect(init.headers['Content-Type']).toBeUndefined();
      expect(init.body).toBeInstanceOf(FormData);
      expect(init.body.get('file')).toBe(file);
    });

    it('throws ApiError on a non-ok response, carrying the backend error body', async () => {
      const file = new File(['x'], 'bad.xlsx');
      global.fetch = jest.fn().mockResolvedValue({
        status: 400,
        ok: false,
        statusText: 'Bad Request',
        text: async () => JSON.stringify({ message: 'No file uploaded' }),
      }) as unknown as typeof fetch;

      await expect(apiClient.postFile('products/import', file)).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('getBlob', () => {
    it('GETs with a Bearer header and returns the raw Blob, not parsed JSON', async () => {
      const blob = new Blob(['xlsx bytes']);
      const fetchMock = jest.fn().mockResolvedValue({ status: 200, ok: true, blob: async () => blob });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await apiClient.getBlob('products/export');

      expect(result).toBe(blob);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('products/export');
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe('Bearer test-token');
    });

    it('throws ApiError on a non-ok response instead of returning a blob', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 403,
        ok: false,
        statusText: 'Forbidden',
        text: async () => JSON.stringify({ message: 'Forbidden' }),
      }) as unknown as typeof fetch;

      await expect(apiClient.getBlob('products/export')).rejects.toMatchObject({ status: 403 });
    });
  });
});
