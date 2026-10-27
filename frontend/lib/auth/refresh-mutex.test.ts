import { serializedRefresh } from './refresh-mutex';

describe('serializedRefresh', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('collapses concurrent calls for the same key into a single underlying fetch', async () => {
    let resolveFetch: (value: unknown) => void;
    const fetchMock = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const call1 = serializedRefresh('test-key', '/api/auth/refresh');
    const call2 = serializedRefresh('test-key', '/api/auth/refresh');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch!({ ok: true, status: 200, text: async () => JSON.stringify({ accessToken: 'new-token' }) });
    const [result1, result2] = await Promise.all([call1, call2]);

    expect(result1).toEqual({ ok: true, status: 200, body: { accessToken: 'new-token' } });
    expect(result2).toEqual({ ok: true, status: 200, body: { accessToken: 'new-token' } });
  });

  it('does not collapse calls with different keys — each gets its own fetch', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ accessToken: 'tok' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await Promise.all([serializedRefresh('key-a', '/a'), serializedRefresh('key-b', '/b')]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh fetch for a later, non-overlapping call with the same key', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ accessToken: 'tok' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await serializedRefresh('test-key', '/api/auth/refresh');
    await serializedRefresh('test-key', '/api/auth/refresh');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
