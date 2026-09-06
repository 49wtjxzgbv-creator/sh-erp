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

  describe('function calling (2026-09-06 follow-up)', () => {
    it('sends AiToolDeclaration[] as OpenAI-shaped tools', async () => {
      fetchMock.mockResolvedValue(fakeFetchResponse(200, { choices: [{ message: { content: 'ok' } }] }));

      await adapter.generateContent(
        [{ role: 'user', parts: [{ text: 'Знайди болт' }] }],
        'key',
        [{ name: 'searchProducts', description: 'Шукає товари', parameters: { type: 'object', properties: {} } }],
      );

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.tools).toEqual([
        { type: 'function', function: { name: 'searchProducts', description: 'Шукає товари', parameters: { type: 'object', properties: {} } } },
      ]);
    });

    it('converts a functionCall reply into AiGenerateResult with no content and one functionCall part', async () => {
      fetchMock.mockResolvedValue(
        fakeFetchResponse(200, {
          choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'searchProducts', arguments: '{"query":"болт"}' } }] } }],
        }),
      );

      const result = await adapter.generateContent([{ role: 'user', parts: [{ text: 'Знайди болт' }] }], 'key', [
        { name: 'searchProducts', description: 'd', parameters: {} },
      ]);

      expect(result.message).toEqual({ role: 'model', parts: [{ functionCall: { name: 'searchProducts', args: { query: 'болт' } } }] });
    });

    it('round-trips a functionCall + functionResponse turn into matching tool_call_id-linked messages', async () => {
      fetchMock.mockResolvedValue(fakeFetchResponse(200, { choices: [{ message: { content: 'Знайдено 3 товари' } }] }));

      const contents = [
        { role: 'user' as const, parts: [{ text: 'Знайди болт' }] },
        { role: 'model' as const, parts: [{ functionCall: { name: 'searchProducts', args: { query: 'болт' } } }] },
        { role: 'user' as const, parts: [{ functionResponse: { name: 'searchProducts', response: { count: 3 } } }] },
      ];

      await adapter.generateContent(contents, 'key', [{ name: 'searchProducts', description: 'd', parameters: {} }]);

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.messages).toHaveLength(3);
      expect(body.messages[0]).toEqual({ role: 'user', content: 'Знайди болт' });
      expect(body.messages[1].role).toBe('assistant');
      expect(body.messages[1].tool_calls).toHaveLength(1);
      const callId = body.messages[1].tool_calls[0].id;
      expect(body.messages[1].tool_calls[0].function).toEqual({ name: 'searchProducts', arguments: '{"query":"болт"}' });
      expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: callId, content: JSON.stringify({ count: 3 }) });
    });

    it('handles two parallel function calls in one turn, matching each response to its own call by position', async () => {
      fetchMock.mockResolvedValue(fakeFetchResponse(200, { choices: [{ message: { content: 'ok' } }] }));

      const contents = [
        { role: 'user' as const, parts: [{ text: 'Порівняй два товари' }] },
        {
          role: 'model' as const,
          parts: [
            { functionCall: { name: 'getProduct', args: { id: 'a' } } },
            { functionCall: { name: 'getProduct', args: { id: 'b' } } },
          ],
        },
        {
          role: 'user' as const,
          parts: [
            { functionResponse: { name: 'getProduct', response: { id: 'a', name: 'Гвинт' } } },
            { functionResponse: { name: 'getProduct', response: { id: 'b', name: 'Гайка' } } },
          ],
        },
      ];

      await adapter.generateContent(contents, 'key', [{ name: 'getProduct', description: 'd', parameters: {} }]);

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      const [callIdA, callIdB] = body.messages[1].tool_calls.map((c: any) => c.id);
      expect(callIdA).not.toBe(callIdB);
      expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: callIdA, content: JSON.stringify({ id: 'a', name: 'Гвинт' }) });
      expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: callIdB, content: JSON.stringify({ id: 'b', name: 'Гайка' }) });
    });
  });
});
