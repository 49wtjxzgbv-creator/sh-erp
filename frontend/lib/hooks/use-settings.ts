'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCompanySettings,
  updateCompanySettings,
  getCompanyBranding,
  updateCompanyBranding,
  type UpdateCompanySettingsInput,
  type UpdateCompanyBrandingInput,
} from '@/lib/api-client/settings';

const settingsKey = ['company-settings'] as const;
const brandingKey = ['company-branding'] as const;

export function useCompanySettings() {
  return useQuery({ queryKey: settingsKey, queryFn: () => getCompanySettings() });
}

export function useUpdateCompanySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateCompanySettingsInput) => updateCompanySettings(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKey }),
  });
}

export function useCompanyBranding() {
  return useQuery({ queryKey: brandingKey, queryFn: () => getCompanyBranding() });
}

export function useUpdateCompanyBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateCompanyBrandingInput) => updateCompanyBranding(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: brandingKey }),
  });
}
