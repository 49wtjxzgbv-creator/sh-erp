'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listUsers,
  inviteUser,
  updateUserRole,
  deactivateUser,
  changeOwnPassword,
  getMyProfile,
  type InviteUserInput,
  type ChangePasswordInput,
} from '@/lib/api-client/users';
import { useSessionStore } from '@/lib/auth/session-store';

const usersKey = ['company-users'] as const;
const myProfileKey = ['users', 'me', 'profile'] as const;

export function useUsers() {
  return useQuery({ queryKey: usersKey, queryFn: () => listUsers() });
}

/** The logged-in user's own name (2026-09-06, dashboard greeting) — no special permission required, works for every role. Keyed on userId+companyId same as useMyPermissions, so switching companies never serves a stale cached name. */
export function useMyProfile() {
  const userId = useSessionStore((s) => s.userId);
  const companyId = useSessionStore((s) => s.companyId);
  return useQuery({
    queryKey: [...myProfileKey, userId, companyId] as const,
    queryFn: () => getMyProfile(),
    enabled: Boolean(userId && companyId),
    staleTime: 60 * 60 * 1000,
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: InviteUserInput) => inviteUser(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) => updateUserRole(userId, roleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => deactivateUser(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useChangeOwnPassword() {
  return useMutation({ mutationFn: (dto: ChangePasswordInput) => changeOwnPassword(dto) });
}
