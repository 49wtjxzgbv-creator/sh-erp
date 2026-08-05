'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { previewLowStockDigest, sendLowStockDigestNow } from '@/lib/api-client/notifications';

const digestPreviewKey = ['low-stock-digest-preview'] as const;

/** Preview content changes as stock moves, so it's a real query (auto-refetched on remount), not just a one-shot mutation. */
export function useLowStockDigestPreview(enabled = true) {
  return useQuery({ queryKey: digestPreviewKey, queryFn: () => previewLowStockDigest(), enabled });
}

export function useSendLowStockDigestNow() {
  return useMutation({ mutationFn: () => sendLowStockDigestNow() });
}
