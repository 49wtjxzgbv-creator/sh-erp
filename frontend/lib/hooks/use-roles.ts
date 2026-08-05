'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getPermissionsCatalogue,
  type CreateRoleInput,
  type UpdateRoleInput,
} from '@/lib/api-client/roles';

const rolesKey = ['roles'] as const;
const permissionsCatalogueKey = ['permissions-catalogue'] as const;

export function useRoles() {
  return useQuery({ queryKey: rolesKey, queryFn: () => listRoles() });
}

/** Static data (the fixed permission catalogue) — long staleTime since it only changes when a new backend module ships. */
export function usePermissionsCatalogue() {
  return useQuery({ queryKey: permissionsCatalogueKey, queryFn: () => getPermissionsCatalogue(), staleTime: 60 * 60 * 1000 });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateRoleInput) => createRole(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKey }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateRoleInput }) => updateRole(id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKey }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKey }),
  });
}
