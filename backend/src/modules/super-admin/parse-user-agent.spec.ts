import { parseUserAgent } from './parse-user-agent';

describe('parseUserAgent', () => {
  it('recognizes Chrome on Windows', () => {
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')).toBe(
      'Chrome · Windows',
    );
  });

  it('recognizes Safari on iOS', () => {
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe(
      'Safari · iOS',
    );
  });

  it('prefers Edge over the Chrome substring Edge\'s own UA also contains', () => {
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0')).toBe(
      'Edge · Windows',
    );
  });

  it('returns "—" for null (no User-Agent captured)', () => {
    expect(parseUserAgent(null)).toBe('—');
  });

  it('falls back to a truncated raw string when nothing recognizable matches', () => {
    expect(parseUserAgent('SomeWeirdBot/1.0')).toBe('SomeWeirdBot/1.0');
  });
});
