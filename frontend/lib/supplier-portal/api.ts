import { getSupplierPortalAccessToken, useSupplierPortalSessionStore } from './session-store';
import { restoreSession } from './actions';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

/**
 * Deliberately its own tiny client, NOT a reuse of `lib/api-client/http.ts`
 * — same reasoning as `lib/super-admin/api.ts`: that client's 401 handling
 * targets the regular app's cookie/store, not this surface's. Same
 * 401-retry-via-silent-refresh shape as `http.ts`, pointed at
 * `/api/supplier-portal/auth/refresh` (P0 fix, 2026-08-20 — added alongside
 * the refresh token itself: the access token TTL was lowered from 7d to
 * 30m on the assumption this retry exists, so a mid-session expiry no
 * longer forces a full re-login).
 */
class SupplierPortalApiClient {
  private async request<T>(method: string, path: string, body?: unknown, skipRefreshRetry = false): Promise<T> {
    const token = getSupplierPortalAccessToken();
    const res = await fetch(`${API_BASE_URL.replace(/\/?$/, '/')}${path.replace(/^\//, '')}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 && !skipRefreshRetry) {
      const refreshed = await restoreSession();
      if (refreshed) {
        return this.request<T>(method, path, body, true);
      }
      useSupplierPortalSessionStore.getState().clearSession();
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const message = (data && (data.message || data.error)) || res.statusText;
      throw new Error(Array.isArray(message) ? message.join(', ') : String(message));
    }
    return data as T;
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }
}

export const supplierPortalApi = new SupplierPortalApiClient();
