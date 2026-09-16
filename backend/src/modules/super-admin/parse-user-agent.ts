/**
 * Deliberately minimal, no new dependency — good enough for a Super Admin
 * "Пристрій" column ("Chrome on Windows"), not a robust device-detection
 * library. Falls back to the raw string when nothing recognizable matches,
 * so an unusual client is still visible, just unparsed.
 */
export function parseUserAgent(userAgent: string | null): string {
  if (!userAgent) return '—';

  let browser = 'Unknown';
  if (/edg\//i.test(userAgent)) browser = 'Edge';
  else if (/opr\/|opera/i.test(userAgent)) browser = 'Opera';
  else if (/chrome|crios/i.test(userAgent)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(userAgent)) browser = 'Firefox';
  else if (/safari/i.test(userAgent)) browser = 'Safari';

  let os = 'Unknown';
  if (/windows/i.test(userAgent)) os = 'Windows';
  else if (/iphone|ipad|ios/i.test(userAgent)) os = 'iOS';
  else if (/mac os x|macintosh/i.test(userAgent)) os = 'macOS';
  else if (/android/i.test(userAgent)) os = 'Android';
  else if (/linux/i.test(userAgent)) os = 'Linux';

  if (browser === 'Unknown' && os === 'Unknown') return userAgent.slice(0, 80);
  return `${browser} · ${os}`;
}
