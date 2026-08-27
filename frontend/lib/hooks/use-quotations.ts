'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  queryQuotations,
  getQuotation,
  createQuotation,
  updateQuotationTerms,
  saveQuotationItems,
  approveBelowCost,
  sendQuotation,
  createNewQuotationVersion,
  duplicateQuotation,
  markQuotationViewed,
  acceptQuotation,
  rejectQuotation,
  convertQuotationToOrder,
  getQuotationPreviewHtml,
  queryQuotationTemplates,
  getQuotationTemplate,
  createQuotationTemplate,
  updateQuotationTemplate,
  deleteQuotationTemplate,
  type QueryQuotationsInput,
  type CreateQuotationInput,
  type UpdateQuotationVersionInput,
  type QuotationItemInput,
  type CreateQuotationTemplateInput,
  type UpdateQuotationTemplateInput,
} from '@/lib/api-client/quotations';

const quotationsKey = (query: QueryQuotationsInput) => ['quotations', query] as const;
const quotationKey = (id: string) => ['quotations', id] as const;
const quotationPreviewKey = (id: string) => ['quotations', id, 'preview'] as const;
const quotationTemplatesKey = ['quotation-templates'] as const;
const quotationTemplateKey = (id: string) => ['quotation-templates', id] as const;

export function useQuotations(query: QueryQuotationsInput) {
  return useQuery({ queryKey: quotationsKey(query), queryFn: () => queryQuotations(query) });
}

export function useQuotation(id: string | undefined) {
  return useQuery({
    queryKey: quotationKey(id ?? ''),
    queryFn: () => getQuotation(id as string),
    enabled: Boolean(id),
  });
}

function invalidateQuotation(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ['quotations'] });
  qc.invalidateQueries({ queryKey: quotationKey(id) });
  qc.invalidateQueries({ queryKey: quotationPreviewKey(id) });
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateQuotationInput) => createQuotation(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });
}

export function useUpdateQuotationTerms(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateQuotationVersionInput) => updateQuotationTerms(id, dto),
    onSuccess: () => invalidateQuotation(qc, id),
  });
}

export function useSaveQuotationItems(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: QuotationItemInput[]) => saveQuotationItems(id, items),
    onSuccess: () => invalidateQuotation(qc, id),
  });
}

export function useApproveBelowCost(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => approveBelowCost(id, itemId),
    onSuccess: () => invalidateQuotation(qc, id),
  });
}

export function useSendQuotation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendQuotation(id),
    onSuccess: () => invalidateQuotation(qc, id),
  });
}

export function useCreateNewQuotationVersion(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => createNewQuotationVersion(id),
    onSuccess: () => invalidateQuotation(qc, id),
  });
}

/** Result is a brand-new Quotation (own id/number/DRAFT) — caller navigates to it, doesn't just invalidate in place. */
export function useDuplicateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => duplicateQuotation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });
}

export function useMarkQuotationViewed(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markQuotationViewed(id),
    onSuccess: () => invalidateQuotation(qc, id),
  });
}

export function useAcceptQuotation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => acceptQuotation(id),
    onSuccess: () => invalidateQuotation(qc, id),
  });
}

export function useRejectQuotation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => rejectQuotation(id),
    onSuccess: () => invalidateQuotation(qc, id),
  });
}

/** Also touches the created CustomerOrder — invalidate that list too so it's visible immediately without a manual refresh. */
export function useConvertQuotationToOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => convertQuotationToOrder(id),
    onSuccess: () => {
      invalidateQuotation(qc, id);
      qc.invalidateQueries({ queryKey: ['customer-orders'] });
    },
  });
}

/** §8: fetched on demand (not on every keystroke — the editor calls refetch() after a successful save), not kept live-subscribed. */
export function useQuotationPreview(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: quotationPreviewKey(id ?? ''),
    queryFn: () => getQuotationPreviewHtml(id as string),
    enabled: enabled && Boolean(id),
  });
}

export function useQuotationTemplates() {
  return useQuery({ queryKey: quotationTemplatesKey, queryFn: () => queryQuotationTemplates() });
}

export function useQuotationTemplate(id: string | undefined) {
  return useQuery({
    queryKey: quotationTemplateKey(id ?? ''),
    queryFn: () => getQuotationTemplate(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateQuotationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateQuotationTemplateInput) => createQuotationTemplate(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: quotationTemplatesKey }),
  });
}

export function useUpdateQuotationTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateQuotationTemplateInput) => updateQuotationTemplate(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: quotationTemplatesKey });
      qc.invalidateQueries({ queryKey: quotationTemplateKey(id) });
    },
  });
}

export function useDeleteQuotationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteQuotationTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: quotationTemplatesKey }),
  });
}
