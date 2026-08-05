import { apiClient } from './http';
import type { CompanyBranding } from './settings';

/**
 * Typed wrappers for the two @Public() backend endpoints that don't involve
 * token issuance and so can be called directly (no cookie proxy needed):
 * company signup and pre-login company discovery. Field shapes copied
 * verbatim from backend/src/modules/tenancy/dto/create-company.dto.ts and
 * backend/src/modules/identity/auth.controller.ts.
 *
 * Login/refresh/logout are NOT here — those go through our own
 * app/api/auth/* route handlers (lib/auth/actions.ts) because they must set
 * the httpOnly refresh cookie, which only a Next.js route handler can do.
 */

export interface CreateCompanyDto {
  companyName: string;
  slug: string;
  timezone?: string;
  locale?: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerFullName: string;
}

export interface CreateCompanyResult {
  id: string;
  slug: string;
  name: string;
}

export function signupCompany(dto: CreateCompanyDto): Promise<CreateCompanyResult> {
  return apiClient.post<CreateCompanyResult>('companies/signup', dto, { skipAuth: true });
}

export interface PublicCompanyInfo {
  id: string;
  slug: string;
  name: string;
  locale: string;
  branding: CompanyBranding | null;
}

export function getPublicCompanyInfo(slug: string): Promise<PublicCompanyInfo> {
  return apiClient.get<PublicCompanyInfo>(`auth/companies/${encodeURIComponent(slug)}/public-info`, {
    skipAuth: true,
  });
}
