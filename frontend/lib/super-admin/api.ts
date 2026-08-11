import { getSuperAdminAccessToken, useSuperAdminSessionStore } from './session-store';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

/**
 * Deliberately its own tiny client, NOT a reuse of `lib/api-client/http.ts`
 * — that client's 401 handling calls the regular app's silent-refresh flow
 * (`/api/auth/refresh`, cookie-based), which has no equivalent for a
 * super-admin session (no refresh token exists at all, see
 * session-store.ts). Reusing it would risk a super-admin 401 accidentally
 * clearing or refreshing the WRONG session. A 401 here just clears the
 * super-admin session and the layout redirects to /super-admin/login.
 */
class SuperAdminApiClient {
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = getSuperAdminAccessToken();
    const res = await fetch(`${API_BASE_URL.replace(/\/?$/, '/')}${path.replace(/^\//, '')}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401) {
      useSuperAdminSessionStore.getState().clearSession();
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
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  delete<T>(path: string) {
    return this.request<T>('DELETE', path);
  }
}

export const superAdminApi = new SuperAdminApiClient();
