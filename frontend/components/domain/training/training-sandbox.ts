'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { deleteProduct } from '@/lib/api-client/catalog';
import { cancelCustomerOrder } from '@/lib/api-client/sales';

const SANDBOX_KEY = 'sh-erp-training-sandbox';

/**
 * Entity types tracked here all have a real, existing "undo" action in the
 * backend (see training-types.ts's `sandboxEntity` comment for why
 * PurchaseOrder is deliberately excluded — no such action exists for it).
 */
export type SandboxEntityType = 'product' | 'assembly' | 'customerOrder';

interface SandboxEntity {
  type: SandboxEntityType;
  id: string;
}

function readSandbox(): SandboxEntity[] {
  try {
    const raw = window.localStorage.getItem(SANDBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeSandbox(entities: SandboxEntity[]) {
  try {
    window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(entities));
  } catch {
    // Not worth surfacing — the entity was still created for real; only the
    // "remember to offer cleanup" bookkeeping is lost.
  }
}

/**
 * Called from training-provider.tsx the moment a practice step's route
 * checkpoint fires — the new pathname's last segment is the real id Next.js
 * just navigated to (every create-form in this app only navigates to
 * `/module/:id` on a successful API response), so this is a genuine record
 * of something the training session actually created, not a guess.
 */
export function recordSandboxEntity(type: SandboxEntityType, id: string) {
  const existing = readSandbox();
  if (existing.some((e) => e.type === type && e.id === id)) return;
  writeSandbox([...existing, { type, id }]);
}

/**
 * "Очистити навчальні дані" — calls each entity's own real, existing
 * cleanup action (soft-delete for Product, cancel for CustomerOrder; no new
 * backend endpoints). Runs sequentially and tolerates individual failures
 * (e.g. a record already removed by other means) rather than aborting the
 * whole batch.
 */
export function useTrainingCleanup() {
  const qc = useQueryClient();
  const [entities, setEntities] = useState<SandboxEntity[]>([]);
  const [isCleaning, setIsCleaning] = useState(false);

  useEffect(() => {
    setEntities(readSandbox());
  }, []);

  const cleanup = useCallback(async () => {
    setIsCleaning(true);
    const current = readSandbox();
    const remaining: SandboxEntity[] = [];
    for (const entity of current) {
      try {
        if (entity.type === 'product') await deleteProduct(entity.id);
        else if (entity.type === 'customerOrder') await cancelCustomerOrder(entity.id);
        // 'assembly' has a real deleteAssembly() too, but no course currently creates one via Practice mode — kept in the type for when one does.
      } catch {
        // Already gone, or the user's permissions changed — leave it out of
        // the retry list either way; a stuck "can't clean up" entry
        // shouldn't block clearing everything else.
      }
    }
    writeSandbox(remaining);
    setEntities(remaining);
    setIsCleaning(false);
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['customer-orders'] });
  }, [qc]);

  return { hasSandboxData: entities.length > 0, cleanup, isCleaning };
}
