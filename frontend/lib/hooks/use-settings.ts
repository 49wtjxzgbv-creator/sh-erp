'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCompanySettings,
  updateCompanySettings,
  getCompanyBranding,
  updateCompanyBranding,
  getCompanyRequisites,
  updateCompanyRequisites,
  type UpdateCompanySettingsInput,
  type UpdateCompanyBrandingInput,
  type UpdateCompanyRequisitesInput,
} from '@/lib/api-client/settings';

const settingsKey = ['company-settings'] as const;
const brandingKey = ['company-branding'] as const;
const requisitesKey = ['company-requisites'] as const;

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

export function useCompanyRequisites() {
  return useQuery({ queryKey: requisitesKey, queryFn: () => getCompanyRequisites() });
}

export function useUpdateCompanyRequisites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateCompanyRequisitesInput) => updateCompanyRequisites(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: requisitesKey }),
  });
}
