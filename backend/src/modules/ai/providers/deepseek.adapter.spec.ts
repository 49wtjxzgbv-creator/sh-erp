import { AiProviderException } from './ai-provider.port';
import { DeepSeekAdapter } from './deepseek.adapter';

function fakeFetchResponse(status: number, body: any) {
  return { status, text: async () => JSON.stringify(body) } as any;
}

describe('DeepSeekAdapter', () => {
  let adapter: DeepSeekAdapter;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    adapter = new DeepSeekAdapter();
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  it('throws without hitting the network when no API key is given', async () => {
    await expect(adapter.generateContent([{ role: 'user', parts: [{ text: 'hi' }] }], '')).rejects.toThrow(AiProviderException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws without hitting the network when tools are passed — function calling is not implemented yet', async () => {
    await expect(
      adapter.generateContent([{ role: 'user', parts: [{ text: 'hi' }] }], 'key', [{ name: 'foo', description: 'd', parameters: {} }]),
    ).rejects.toThrow(AiProviderException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps AiMessage[] to OpenAI-shaped {role, content} messages, and the reply back into AiGenerateResult', async () => {
    fetchMock.mockResolvedValue(
      fakeFetchResponse(200, {
        choices: [{ message: { role: 'assistant', content: 'Привіт!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );

    const result = await adapter.generateContent(
      [
        { role: 'user', parts: [{ text: 'Питання' }] },
        { role: 'model', parts: [{ text: 'Попередня відповідь' }] },
      ],
      'test-key',
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.headers.authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages).toEqual([
      { role: 'user', content: 'Питання' },
      { role: 'assistant', content: 'Попередня відповідь' },
    ]);

    expect(result).toEqual({
      message: { role: 'model', parts: [{ text: 'Привіт!' }] },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  });

  it('retries once on a 429 rate-limit, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeFetchResponse(429, { error: { message: 'rate limited' } }))
      .mockResolvedValueOnce(fakeFetchResponse(200, { choices: [{ message: { content: 'ok' } }] }));

    const resultPromise = adapter.generateContent([{ role: 'user', parts: [{ text: 'hi' }] }], 'key');
    await Promise.resolve(); // let the first fetch settle before the retry's setTimeout is scheduled
    jest.useRealTimers();
    const result = await resultPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.message.parts[0].text).toBe('ok');
  });

  it('throws a clear message on 401/403 without retrying', async () => {
    fetchMock.mockResolvedValue(fakeFetchResponse(401, { error: { message: 'invalid key' } }));
    await expect(adapter.generateContent([{ role: 'user', parts: [{ text: 'hi' }] }], 'bad-key')).rejects.toThrow(AiProviderException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the response has no message content', async () => {
    fetchMock.mockResolvedValue(fakeFetchResponse(200, { choices: [{ message: {} }] }));
    await expect(adapter.generateContent([{ role: 'user', parts: [{ text: 'hi' }] }], 'key')).rejects.toThrow(AiProviderException);
  });
});
