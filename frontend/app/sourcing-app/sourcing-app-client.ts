'use client';

import { ApiError, type ApiErrorBody } from '@/lib/api-client/types';
import { getTelegramWebApp } from './telegram-webapp';

/**
 * Base URL for the Mini App's own backend API (2026-11-10) — a SEPARATE
 * process/port from the main ERP API (`NEXT_PUBLIC_API_BASE_URL`), see
 * `backend/src/modules/sourcing-bot/main.ts`'s header comment. In
 * production this is `https://<app-domain>/sourcing-app-api` (Nginx
 * strips that prefix and forwards to the sourcing-bot process's own
 * `:3003`, see `ops/nginx/app.conf.template`); in local dev it points
 * straight at that port.
 */
const SOURCING_APP_API_BASE_URL = process.env.NEXT_PUBLIC_SOURCING_APP_API_URL ?? 'http://localhost:3003';

/**
 * No JWT/cookie here — identity comes from Telegram's own `initData`
 * (`TelegramWebAppAuthGuard` on the backend), re-sent fresh on every call
 * since Telegram re-signs it per session, not something this client caches
 * itself.
 */
class SourcingAppClient {
  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`api/v1/sourcing-app/${path.replace(/^\//, '')}`, SOURCING_APP_API_BASE_URL.replace(/\/?$/, '/'));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, value);
      }
    }

    const initData = getTelegramWebApp()?.initData ?? '';
    const res = await fetch(url.toString(), {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;

    if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody, res.statusText);
    return data as T;
  }

  get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
}

export const sourcingAppClient = new SourcingAppClient();

export interface PriceEntry {
  field: string;
  icon: string;
  label: string;
  value: number;
}

export interface SourcingCategorySummary {
  id: string;
  code: string;
  name: string;
  productCount: number;
}

export interface ProductRow {
  id: string;
  article: string;
  name: string;
  photoUrl: string | null;
  prices: PriceEntry[];
  supplierCount: number;
}

export interface ProductListResponse {
  items: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface RealSupplierPrice {
  id: string;
  name: string;
  ourPrice: number | null;
  supplierOfferedPrice: number | null;
}

export type OutreachStatus = 'NOT_CONTACTED' | 'CONTACTED' | 'AWAITING_RESPONSE' | 'RESPONDED' | 'QUOTE_RECEIVED' | 'REJECTED' | 'WON';

export interface CandidateSupplier {
  id: string;
  name: string;
  region: string | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  whatTheyDo: string | null;
  status: OutreachStatus;
  statusLabel: string;
  category?: { id: string; name: string };
  lastNote?: string | null;
  quotedPriceEur?: number | null;
  quotedPriceNote?: string | null;
}

export interface ProductDetail {
  id: string;
  article: string;
  name: string;
  /** Every uploaded photo, newest first — not just one (2026-11-10 — "перегляд фото товарів"), for a tap-to-zoom gallery. */
  photoUrls: string[];
  /** Presigned .glb URL if this product has a usable 3D model among its PRODUCT_DOCUMENT files (2026-11-10 — "і 3д") — null when none exists. */
  modelUrl: string | null;
  /** PDF/DXF files among this product's PRODUCT_DOCUMENT files (2026-11-10 — "щоб у картку товару підтягувався пдф файл і dxf якщо вони є"), excluding whichever file `modelUrl` itself came from. */
  documents: Array<{ id: string; name: string; url: string }>;
  prices: PriceEntry[];
  category: { id: string; name: string; rfqTemplate: string } | null;
  realSuppliers: RealSupplierPrice[];
  candidateSuppliers: CandidateSupplier[];
}

export interface RealSupplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  products: Array<{ id: string; article: string; name: string; ourPrice: number | null; supplierOfferedPrice: number | null }>;
}

export interface StatusOverview {
  counts: Record<OutreachStatus, number>;
  items: Array<{ id: string; name: string; categoryName: string; status: OutreachStatus; statusLabel: string }>;
}

export interface UpdateOutreachInput {
  status?: OutreachStatus;
  note?: string;
  quotedPriceEur?: number;
  quotedPriceNote?: string;
}

/** "має бути можливість додавати можливих постачальників" (2026-11-10) — form equivalent of the bot's own admin-only add-candidate flow. */
export interface CreateCandidateInput {
  categoryId: string;
  name: string;
  region?: string;
  location?: string;
  phone?: string;
  email?: string;
  website?: string;
  whatTheyDo?: string;
}

/** "ALL" sentinel categoryId (2026-11-10 — "категорія всі, щоб просто гортати всі товари") — must match the backend's ALL_CATEGORIES_ID exactly. */
export const ALL_CATEGORIES_ID = 'all';
