import { superAdminApi } from './api';
import type { LandingPageContent } from '@/lib/landing-page/types';

export interface LandingPageVersionRow {
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  versionNumber: number | null;
  content: LandingPageContent;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface LandingMediaAssetRow {
  id: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
  createdAt: string;
}

const BASE = 'super-admin/landing-page';

export const landingPageAdminApi = {
  getDraft: () => superAdminApi.get<LandingPageVersionRow>(`${BASE}/draft`),
  saveDraft: (content: LandingPageContent) => superAdminApi.put<LandingPageVersionRow>(`${BASE}/draft`, { content }),
  discardDraft: () => superAdminApi.post<LandingPageVersionRow>(`${BASE}/draft/discard`),
  publish: () => superAdminApi.post<LandingPageVersionRow>(`${BASE}/publish`),
  listVersions: () =>
    superAdminApi.get<Array<Pick<LandingPageVersionRow, 'id' | 'versionNumber' | 'status' | 'publishedAt' | 'createdAt'>>>(`${BASE}/versions`),
  getVersion: (id: string) => superAdminApi.get<LandingPageVersionRow>(`${BASE}/versions/${id}`),
  restoreVersion: (id: string) => superAdminApi.post<LandingPageVersionRow>(`${BASE}/versions/${id}/restore`),

  listMedia: () => superAdminApi.get<LandingMediaAssetRow[]>(`${BASE}/media`),
  deleteMedia: (id: string) => superAdminApi.delete<{ ok: boolean }>(`${BASE}/media/${id}`),

  /** Full upload flow: presign -> PUT to R2 directly -> confirm. Returns the created media row. */
  async uploadMedia(file: File): Promise<LandingMediaAssetRow> {
    const { mediaId, uploadUrl } = await superAdminApi.post<{ mediaId: string; uploadUrl: string }>(`${BASE}/media/presigned-upload`, {
      originalName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    });

    const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!putRes.ok) throw new Error(`Upload to storage failed: ${putRes.status}`);

    return superAdminApi.post<LandingMediaAssetRow>(`${BASE}/media/${mediaId}/confirm`);
  },
};
