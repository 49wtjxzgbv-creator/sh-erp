import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/authorization/roles.controller.ts
 * (path `roles`) — the per-company custom-roles CRUD surface. `RolesService`
 * itself has existed since Module 1 (seeding the 5 defaults at signup), but
 * this controller — added in the production-readiness pass — is what
 * finally exposes it. All routes require `roles:manage`.
 */

export interface PermissionDefinition {
  key: string;
  resource: string;
  action: string;
  description: string;
}

export function getPermissionsCatalogue(): Promise<PermissionDefinition[]> {
  return apiClient.get<PermissionDefinition[]>('roles/permissions-catalogue');
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionKeys: string[];
}

export function listRoles(): Promise<Role[]> {
  return apiClient.get<Role[]>('roles');
}

/** Unlike every other route in this file, does NOT require `roles:manage` — any authenticated user can read their own grants. */
export function getMyPermissions(): Promise<{ permissionKeys: string[] }> {
  return apiClient.get<{ permissionKeys: string[] }>('roles/me/permissions');
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissionKeys: string[];
}

export function createRole(dto: CreateRoleInput): Promise<Role> {
  return apiClient.post<Role>('roles', dto);
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissionKeys?: string[];
}

export function updateRole(id: string, dto: UpdateRoleInput): Promise<Role> {
  return apiClient.patch<Role>(`roles/${id}`, dto);
}

/** Rejected by the backend (400, not silently ignored) if the role is a default system role or still assigned to a member. */
export function deleteRole(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiClient.delete<{ id: string; deleted: boolean }>(`roles/${id}`);
}
