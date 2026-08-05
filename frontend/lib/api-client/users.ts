import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/users/ (UsersController, path
 * `users`) — the production-readiness-review addition that finally lets a
 * company add more than its one signup admin. Field shapes copied verbatim
 * from users.service.ts/the real DTOs.
 *
 * `invite()`'s response includes `tempPassword` exactly once, only when a
 * brand-new account was created (not when an existing user was attached to
 * this company) — the backend's own header comment explains why: there is
 * no separate "pending invitation" model in this schema, the account is
 * created immediately with a random password, emailed via SMTP if
 * configured, and returned once in the response so the inviting admin can
 * relay it manually if SMTP isn't set up. The UI must show this prominently
 * and exactly once — it is never retrievable again after this response.
 *
 * `deactivate()` removes the CompanyMembership (this company's access
 * only), never the global User row — a person can belong to more than one
 * company. Permissions: `users:manage` gates list/updateRole/deactivate,
 * `users:invite` gates invite specifically (a company could grant invite
 * rights without full manage rights), and changeOwnPassword needs no
 * special permission beyond being authenticated.
 */

export interface CompanyMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  active: boolean;
  roleId: string;
  roleName: string | null;
  memberSince: string;
}

export function listUsers(): Promise<CompanyMember[]> {
  return apiClient.get<CompanyMember[]>('users');
}

export interface InviteUserInput {
  email: string;
  fullName: string;
  roleId: string;
}

export interface InviteUserResult {
  userId: string;
  email: string;
  fullName: string;
  roleId: string;
  tempPassword: string | null;
}

export function inviteUser(dto: InviteUserInput): Promise<InviteUserResult> {
  return apiClient.post<InviteUserResult>('users/invite', dto);
}

export function updateUserRole(userId: string, roleId: string): Promise<unknown> {
  return apiClient.patch(`users/${userId}/role`, { roleId });
}

export function deactivateUser(userId: string): Promise<{ userId: string; removed: boolean }> {
  return apiClient.post<{ userId: string; removed: boolean }>(`users/${userId}/deactivate`);
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export function changeOwnPassword(dto: ChangePasswordInput): Promise<{ changed: boolean }> {
  return apiClient.patch<{ changed: boolean }>('users/me/password', dto);
}
