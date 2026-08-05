'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listUsers,
  inviteUser,
  updateUserRole,
  deactivateUser,
  changeOwnPassword,
  type InviteUserInput,
  type ChangePasswordInput,
} from '@/lib/api-client/users';

const usersKey = ['company-users'] as const;

export function useUsers() {
  return useQuery({ queryKey: usersKey, queryFn: () => listUsers() });
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
