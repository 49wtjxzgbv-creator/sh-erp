'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  askHelp,
  askAboutCustomerOrder,
  askFullAssistant,
  confirmAiAction,
  cancelAiAction,
  recognizeInvoice,
  getAiSettings,
  updateAiSettings,
  type AskFullAssistantInput,
  type UpdateCompanyAiSettingsInput,
} from '@/lib/api-client/ai';

/**
 * All three ask-* entry points and the invoice recognizer are one-shot
 * requests, not cached server state (each call is a distinct question, not
 * a resource with an identity) — modeled as mutations, not queries, same
 * choice as every write-only action elsewhere in this project. Only
 * `ai/settings` is a real cacheable resource.
 */

export function useAskHelp() {
  return useMutation({ mutationFn: (question: string) => askHelp(question) });
}

export function useAskAboutCustomerOrder() {
  return useMutation({
    mutationFn: ({ customerOrderId, question }: { customerOrderId: string; question: string }) =>
      askAboutCustomerOrder(customerOrderId, question),
  });
}

export function useAskFullAssistant() {
  return useMutation({ mutationFn: (dto: AskFullAssistantInput) => askFullAssistant(dto) });
}

export function useConfirmAiAction() {
  return useMutation({ mutationFn: (pendingActionId: string) => confirmAiAction(pendingActionId) });
}

export function useCancelAiAction() {
  return useMutation({ mutationFn: (pendingActionId: string) => cancelAiAction(pendingActionId) });
}

export function useRecognizeInvoice() {
  return useMutation({
    mutationFn: ({ base64Image, mimeType }: { base64Image: string; mimeType: string }) => recognizeInvoice(base64Image, mimeType),
  });
}

const aiSettingsKey = ['ai-settings'] as const;

export function useAiSettings() {
  return useQuery({ queryKey: aiSettingsKey, queryFn: () => getAiSettings() });
}

export function useUpdateAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateCompanyAiSettingsInput) => updateAiSettings(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiSettingsKey }),
  });
}
