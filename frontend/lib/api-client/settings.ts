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

export interface CompanyRequisites {
  companyId: string;
  legalName: string | null;
  taxId: string | null;
  legalAddress: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankIban: string | null;
  bankMfo: string | null;
  website: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `undefined`/omitted = leave as-is, `null` = clear the field — see update-requisites.dto.ts's own header comment. The form always submits the full current state, so callers should pass null (not omit) for a field the user cleared. */
export interface UpdateCompanyRequisitesInput {
  legalName?: string | null;
  taxId?: string | null;
  legalAddress?: string | null;
  phone?: string | null;
  email?: string | null;
  bankName?: string | null;
  bankIban?: string | null;
  bankMfo?: string | null;
  website?: string | null;
}

/** Same "no permission guard on GET" shape as getCompanyBranding above — requisites feed into the Quotation PDF's company-details block, so any authenticated user who can view a KП needs to be able to read them, not just settings:manage. */
export function getCompanyRequisites(): Promise<CompanyRequisites | null> {
  return apiClient.get<CompanyRequisites | null>('company-settings/requisites');
}

export function updateCompanyRequisites(dto: UpdateCompanyRequisitesInput): Promise<CompanyRequisites> {
  return apiClient.patch<CompanyRequisites>('company-settings/requisites', dto);
}
