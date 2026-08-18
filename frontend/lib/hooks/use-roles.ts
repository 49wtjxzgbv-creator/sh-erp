'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getPermissionsCatalogue,
  getMyPermissions,
  type CreateRoleInput,
  type UpdateRoleInput,
} from '@/lib/api-client/roles';
import { useSessionStore } from '@/lib/auth/session-store';

const rolesKey = ['roles'] as const;
const permissionsCatalogueKey = ['permissions-catalogue'] as const;
const myPermissionsKey = ['roles', 'me', 'permissions'] as const;

export function useRoles() {
  return useQuery({ queryKey: rolesKey, queryFn: () => listRoles() });
}

/** Static data (the fixed permission catalogue) — long staleTime since it only changes when a new backend module ships. */
export function usePermissionsCatalogue() {
  return useQuery({ queryKey: permissionsCatalogueKey, queryFn: () => getPermissionsCatalogue(), staleTime: 60 * 60 * 1000 });
}

/**
 * The logged-in user's own effective permission keys. Keyed on
 * `userId`+`companyId` (not just `myPermissionsKey`) so switching companies
 * — impersonation, or an admin changing your own role while you're logged
 * in elsewhere — doesn't serve a stale cached set from before the switch.
 *
 * Deliberately NOT keyed/gated on `session-store`'s `roleId` — nothing in
 * the real login/refresh flow (lib/auth/actions.ts) ever populates it
 * (SessionResponse only carries accessToken/userId/companyId/companySlug),
 * so it is always `null` in practice. Gating `enabled` on it here was a
 * real bug caught in live testing: the query never fired, so every
 * `RequirePermission`/layout guard depending on `isSuccess` hung on its
 * loading state forever, for every role including Admin.
 */
export function useMyPermissions() {
  const userId = useSessionStore((s) => s.userId);
  const companyId = useSessionStore((s) => s.companyId);
  return useQuery({
    queryKey: [...myPermissionsKey, userId, companyId] as const,
    queryFn: () => getMyPermissions(),
    enabled: Boolean(userId && companyId),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Drives every "hide (not just disable) an action this role can't perform"
 * check across the app — see backend/src/common/interceptors/tenant-scope.interceptor.ts
 * for the backend-side enforcement this mirrors. Requiring ALL given keys
 * matches that interceptor's own AND semantics for multi-key
 * `@RequirePermissions(...)` routes. Fails closed (returns `false`) while
 * the permission set hasn't loaded yet, so an action never flashes visible
 * before its real gate is known.
 */
export function useHasPermission(...keys: string[]): boolean {
  const { data } = useMyPermissions();
  return useMemo(() => {
    if (!data) return false;
    const granted = new Set(data.permissionKeys);
    return keys.every((k) => granted.has(k));
  }, [data, keys]);
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
