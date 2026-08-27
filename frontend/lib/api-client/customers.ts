import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/customers/ (CustomersController).
 * Lightweight counterparty directory, deliberately the same read/write
 * shape as Supplier (lib/api-client/procurement.ts#Supplier) plus `address`
 * — see CustomersService's own header comment for why.
 */
export interface Customer {
  id: string;
  companyId: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateCustomerInput {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

export interface QueryCustomersInput {
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface PaginatedCustomers {
  items: Customer[];
  total: number;
  limit: number;
  offset: number;
}

export function queryCustomers(query: QueryCustomersInput = {}): Promise<PaginatedCustomers> {
  return apiClient.get<PaginatedCustomers>('customers', { query: query as Record<string, string | number | boolean> });
}
export function getCustomer(id: string): Promise<Customer> {
  return apiClient.get<Customer>(`customers/${id}`);
}
export function createCustomer(dto: CreateCustomerInput): Promise<Customer> {
  return apiClient.post<Customer>('customers', dto);
}
export function updateCustomer(id: string, dto: UpdateCustomerInput): Promise<Customer> {
  return apiClient.patch<Customer>(`customers/${id}`, dto);
}
export function deleteCustomer(id: string): Promise<Customer> {
  return apiClient.delete<Customer>(`customers/${id}`);
}
