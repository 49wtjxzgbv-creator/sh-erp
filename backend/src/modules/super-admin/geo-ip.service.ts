import { Injectable, Logger } from '@nestjs/common';

export interface GeoIpResult {
  city: string | null;
  country: string | null;
}

interface CacheEntry {
  result: GeoIpResult;
  cachedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — an IP's geolocation doesn't change minute to minute, and this keeps repeat page loads of the same recent sessions from re-querying ip-api.com every time.
const BATCH_ENDPOINT = 'http://ip-api.com/batch'; // free tier is HTTP-only (no HTTPS) — called server-to-server here, not from the browser, so no mixed-content concern.
const MAX_BATCH_SIZE = 100; // ip-api.com's own hard limit per batch request.

/**
 * "Геолокація" (Super Admin login-sessions view, 2026-09-16 user request) —
 * this codebase has no IP-geolocation capability at all before this; the
 * user explicitly chose the free ip-api.com batch endpoint (no API key, no
 * account) over a self-hosted MaxMind GeoLite2 database, accepting that
 * IPs get sent to a third party in exchange for zero setup/maintenance.
 * Deliberately just city+country (nothing more precise is meaningful from
 * IP alone, and nothing more is needed here) and deliberately NOT
 * persisted — this is a live lookup for whatever page of sessions is
 * currently being viewed, not a stored fact about the login.
 */
@Injectable()
export class GeoIpService {
  private readonly logger = new Logger(GeoIpService.name);
  private readonly cache = new Map<string, CacheEntry>();

  async lookupMany(ips: string[]): Promise<Map<string, GeoIpResult>> {
    const uniqueIps = Array.from(new Set(ips.filter((ip) => ip && !this.isPrivateOrLocal(ip))));
    const now = Date.now();
    const result = new Map<string, GeoIpResult>();

    const toFetch: string[] = [];
    for (const ip of uniqueIps) {
      const cached = this.cache.get(ip);
      if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
        result.set(ip, cached.result);
      } else {
        toFetch.push(ip);
      }
    }

    for (let i = 0; i < toFetch.length; i += MAX_BATCH_SIZE) {
      const batch = toFetch.slice(i, i + MAX_BATCH_SIZE);
      try {
        const res = await fetch(BATCH_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch.map((query) => ({ query, fields: 'status,country,city,query' }))),
        });
        if (!res.ok) throw new Error(`ip-api.com responded ${res.status}`);
        const rows = (await res.json()) as Array<{ status: string; country?: string; city?: string; query: string }>;
        for (const row of rows) {
          const geo: GeoIpResult = row.status === 'success' ? { city: row.city ?? null, country: row.country ?? null } : { city: null, country: null };
          this.cache.set(row.query, { result: geo, cachedAt: now });
          result.set(row.query, geo);
        }
      } catch (err) {
        // Geolocation is a nice-to-have overlay on the session list, not
        // load-bearing — a failed/unreachable lookup shows "—" for those
        // rows rather than failing the whole page.
        this.logger.warn(`ip-api.com batch lookup failed: ${(err as Error).message}`);
        for (const ip of batch) result.set(ip, { city: null, country: null });
      }
    }

    return result;
  }

  private isPrivateOrLocal(ip: string): boolean {
    return (
      ip === '::1' ||
      ip === '127.0.0.1' ||
      ip.startsWith('::ffff:127.') ||
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    );
  }
}
