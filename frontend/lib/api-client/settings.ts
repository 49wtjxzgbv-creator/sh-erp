import { apiClient } from './http';
import type { DecimalString } from './decimal';

/**
 * Typed wrappers for backend/src/modules/settings/ (SettingsController,
 * path `company-settings`). Field shapes copied verbatim from
 * dto/update-settings.dto.ts, dto/update-branding.dto.ts, and
 * schema.prisma's CompanySettings/CompanyBranding models.
 */

export interface CompanySettings {
  companyId: string;
  vatRatePercent: DecimalString;
  dashboardWidgets: string[];
  dailyDigestEmail: string | null;
  dailyDigestEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCompanySettingsInput {
  vatRatePercent?: number;
  dashboardWidgets?: string[];
  dailyDigestEmail?: string;
  dailyDigestEnabled?: boolean;
}

export function getCompanySettings(): Promise<CompanySettings> {
  return apiClient.get<CompanySettings>('company-settings');
}

export function updateCompanySettings(dto: UpdateCompanySettingsInput): Promise<CompanySettings> {
  return apiClient.patch<CompanySettings>('company-settings', dto);
}

export interface CompanyBranding {
  companyId: string;
  siteLogoFileId: string | null;
  printLogoFileId: string | null;
  faviconFileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCompanyBrandingInput {
  siteLogoFileId?: string;
  printLogoFileId?: string;
  faviconFileId?: string;
}

/**
 * Unlike every other endpoint in this file, GET /company-settings/branding
 * has no @RequirePermissions guard on the backend (branding is meant to be
 * visible pre-login for the login screen, mirroring
 * auth.controller.ts#getPublicCompanyInfo) — but it's still only reachable
 * here from inside the authenticated shell where a bearer token exists
 * anyway, so no special client-side handling is needed for that fact.
 */
export function getCompanyBranding(): Promise<CompanyBranding | null> {
  return apiClient.get<CompanyBranding | null>('company-settings/branding');
}

export function updateCompanyBranding(dto: UpdateCompanyBrandingInput): Promise<CompanyBranding> {
  return apiClient.patch<CompanyBranding>('company-settings/branding', dto);
}
