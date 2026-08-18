'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useHasPermission, useMyPermissions } from '@/lib/hooks/use-roles';
import { LoadingBlock } from '@/components/ui/loading-block';

/**
 * Page-level guard for routes with no useful read-only view — create/new
 * forms, admin-only screens — where a role lacking the permission
 * shouldn't be able to land here at all even by typing the URL directly
 * (the entry-point Button/Link to this route is already hidden elsewhere,
 * this is the defense-in-depth backstop). Renders nothing but a loading
 * block until `useMyPermissions()` resolves, to avoid a flash of content
 * before redirecting. The backend's own `@RequirePermissions` 403 remains
 * the real enforcement; this only improves the UX of what the user sees en
 * route to that 403.
 */
export function RequirePermission({
  permission,
  redirectTo,
  children,
}: {
  permission: string | string[];
  redirectTo: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const keys = Array.isArray(permission) ? permission : [permission];
  const allowed = useHasPermission(...keys);
  const { isSuccess } = useMyPermissions();

  useEffect(() => {
    if (isSuccess && !allowed) router.replace(redirectTo);
  }, [isSuccess, allowed, router, redirectTo]);

  if (!isSuccess || !allowed) return <LoadingBlock />;
  return <>{children}</>;
}
