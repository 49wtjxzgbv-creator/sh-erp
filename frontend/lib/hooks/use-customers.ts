'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  queryCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  type QueryCustomersInput,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from '@/lib/api-client/customers';

const customersKey = (query: QueryCustomersInput) => ['customers', query] as const;
const customerKey = (id: string) => ['customers', id] as const;

export function useCustomers(query: QueryCustomersInput) {
  return useQuery({ queryKey: customersKey(query), queryFn: () => queryCustomers(query) });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: customerKey(id ?? ''),
    queryFn: () => getCustomer(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateCustomerInput) => createCustomer(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}

export function useUpdateCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateCustomerInput) => updateCustomer(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: customerKey(id) });
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCustomer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}
