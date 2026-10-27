'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listTransportUnitTypes,
  createTransportUnitType,
  updateTransportUnitType,
  deleteTransportUnitType,
  type CreateTransportUnitTypeInput,
  type UpdateTransportUnitTypeInput,
} from '@/lib/api-client/logistics';

const transportUnitTypesKey = ['transport-unit-types'] as const;

export function useTransportUnitTypes() {
  return useQuery({ queryKey: transportUnitTypesKey, queryFn: () => listTransportUnitTypes() });
}

export function useCreateTransportUnitType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateTransportUnitTypeInput) => createTransportUnitType(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: transportUnitTypesKey }),
  });
}

export function useUpdateTransportUnitType(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateTransportUnitTypeInput) => updateTransportUnitType(id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: transportUnitTypesKey }),
  });
}

export function useDeleteTransportUnitType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTransportUnitType(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: transportUnitTypesKey }),
  });
}
