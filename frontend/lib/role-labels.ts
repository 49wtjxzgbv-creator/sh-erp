const DEFAULT_ROLE_NAME_KEYS: Record<string, string> = {
  Admin: 'defaultRoleAdmin',
  Storekeeper: 'defaultRoleStorekeeper',
  Production: 'defaultRoleProduction',
  Sales: 'defaultRoleSales',
  Viewer: 'defaultRoleViewer',
};

/**
 * Only the 5 seeded default role names (permissions.catalogue.ts's
 * DEFAULT_ROLES) are translatable — every other role name is a
 * company-authored free-text string with no translation key to look up.
 * Matches by name, not by `role.isSystem`: isSystem roles can still be
 * renamed (roles.service.ts's own comment), so keying off the flag would
 * silently override a deliberate rename with a stale translated label.
 */
export function roleDisplayName(t: (key: string) => string, name: string): string {
  const key = DEFAULT_ROLE_NAME_KEYS[name];
  return key ? t(key) : name;
}

/** Same reasoning as roleDisplayName, for the fixed permission catalogue (permissions.catalogue.ts) — resource/action names are stable code identifiers, safe to build a translation key from. */
export function permissionResourceLabel(t: (key: string) => string, resource: string): string {
  return t(`permissionResource_${resource}`);
}

export function permissionDescriptionLabel(t: (key: string) => string, permissionKey: string): string {
  return t(`permission_${permissionKey.replace(':', '_')}`);
}
