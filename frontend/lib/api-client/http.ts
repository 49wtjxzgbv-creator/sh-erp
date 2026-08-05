import { ApiError, type ApiErrorBody, type ApiRequestOptions } from './types';
import { useSessionStore, getAccessToken } from '../auth/session-store';

/**
 * Backend base URL — points directly at the NestJS API (`/api/v1` prefix
 * confirmed in backend/src/main.ts). Not proxied through Next.js: only the
 * three auth flows and file-upload presigning are Next-owned concerns
 * (Phase 2 §3.1); every other module talks to this URL straight from the
 * browser, carrying the in-memory access token as a Bearer header.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

/**
 * This client is intentionally browser-only. The access token lives only in
 * the Zustand store in memory (lib/auth/session-store.ts) and is never
 * available to a Server Component render — so authenticated data fetching
 * in this app happens client-side, through TanStack Query hooks calling
 * `apiClient`, not through direct `fetch` calls in Server Components. Server
 * Components are still used for the public marketing/login shell and static
 * layout chrome, just not for data that requires the bearer token.
 */
class ApiClient {
  private async request<T>(method: string, path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
    const url = new URL(path.replace(/^\//, ''), API_BASE_URL.replace(/\/?$/, '/'));
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!options.skipAuth) {
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });

    if (res.status === 401 && !options.skipAuth && !options.skipRefreshRetry) {
      const refreshed = await this.trySilentRefresh();
      if (refreshed) {
        return this.request<T>(method, path, body, { ...options, skipRefreshRetry: true });
      }
      useSessionStore.getState().clearSession();
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;

    if (!res.ok) {
      throw new ApiError(res.status, data as ApiErrorBody, res.statusText);
    }

    return data as T;
  }

  /**
   * Calls our own Next.js route handler (app/api/auth/refresh/route.ts,
   * built in the auth-shell task), which reads the httpOnly refresh cookie,
   * rotates it against the backend, and returns a fresh access token. Same
   * origin, so the cookie rides along automatically with credentials:
   * 'include'.
   */
  private async trySilentRefresh(): Promise<boolean> {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string; userId: string; companyId: string; companySlug?: string };
      useSessionStore.getState().setSession(data);
      return true;
    } catch {
      return false;
    }
  }

  get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  /**
   * Multipart file upload — a genuinely new transport for this client.
   * Every other authenticated call in this app is JSON via `request()`
   * above; this bypasses that (no `Content-Type` header set manually, so
   * the browser fills in the multipart boundary itself) for the one
   * feature so far that needs it: Excel product import
   * (`lib/api-client/catalog.ts#importProducts`), which the backend
   * accepts via NestJS's `FileInterceptor`, not the R2 presigned-upload
   * flow every durable per-entity attachment uses (see that function's own
   * header comment for why this is the right transport for a one-shot,
   * server-processed file rather than a `FileAsset`).
   */
  async postFile<T>(path: string, file: File, fieldName = 'file', options: ApiRequestOptions = {}): Promise<T> {
    const url = new URL(path.replace(/^\//, ''), API_BASE_URL.replace(/\/?$/, '/'));
    const headers: Record<string, string> = {};
    if (!options.skipAuth) {
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const formData = new FormData();
    formData.append(fieldName, file);

    const res = await fetch(url.toString(), { method: 'POST', headers, body: formData, signal: options.signal });

    if (res.status === 401 && !options.skipAuth && !options.skipRefreshRetry) {
      const refreshed = await this.trySilentRefresh();
      if (refreshed) {
        return this.postFile<T>(path, file, fieldName, { ...options, skipRefreshRetry: true });
      }
      useSessionStore.getState().clearSession();
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody, res.statusText);
    return data as T;
  }

  /**
   * Binary download — the counterpart to `postFile`, used by
   * `lib/api-client/catalog.ts#exportProducts` (the backend streams back a
   * real `.xlsx` file, not JSON). Same auth/401-retry handling as
   * `request()`, just returning a `Blob` instead of parsing JSON.
   */
  async getBlob(path: string, options: ApiRequestOptions = {}): Promise<Blob> {
    const url = new URL(path.replace(/^\//, ''), API_BASE_URL.replace(/\/?$/, '/'));
    const headers: Record<string, string> = {};
    if (!options.skipAuth) {
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url.toString(), { method: 'GET', headers, signal: options.signal });

    if (res.status === 401 && !options.skipAuth && !options.skipRefreshRetry) {
      const refreshed = await this.trySilentRefresh();
      if (refreshed) {
        return this.getBlob(path, { ...options, skipRefreshRetry: true });
      }
      useSessionStore.getState().clearSession();
    }

    if (!res.ok) {
      const text = await res.text();
      const data = text ? JSON.parse(text) : undefined;
      throw new ApiError(res.status, data as ApiErrorBody, res.statusText);
    }
    return res.blob();
  }
  post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }
  patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }
  put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }
  delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }
}

export const apiClient = new ApiClient();
