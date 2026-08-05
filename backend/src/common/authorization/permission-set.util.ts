import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../decorators/current-user.decorator';

/**
 * Loads the caller's granted permission-key set once, up front, so a piece
 * of code that is NOT a normal `@RequirePermissions()`-guarded route (which
 * gates the whole endpoint) can self-restrict what it returns WITHIN one
 * response — e.g. stripping price fields from a Product export for a role
 * that lacks `reports:valuation`, mirroring the legacy `user.role === 'admin'`
 * check in `ImportExport.gs#exportProducts`. Same Role→RolePermission→Permission
 * join `TenantScopeInterceptor` does for its own allow/deny check, exposed
 * here as a reusable helper since the interceptor discards its resolved set
 * after the check and never attaches it to the request.
 *
 * Originally lived in `modules/ai/ai-permissions.util.ts` (built for
 * `AiToolsRegistry`'s tool-context, which has the same "not a normal guarded
 * route" shape — a tool call is dispatched from inside `AiService`'s loop,
 * never passes through the interceptor on its own). Relocated here during
 * the Excel import/export build (production-readiness pass) once a second,
 * non-AI caller (`ProductsImportExportService`) needed the exact same logic
 * — it never had any AI-specific behavior, so this is a pure move, not a
 * fork. `modules/ai/*` now imports from this file instead.
 */
export async function loadPermissionSet(prisma: PrismaService, user: RequestUser): Promise<Set<string>> {
  const role = await prisma.tenant.role.findUnique({
    where: { id: user.roleId },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) return new Set();
  return new Set((role as any).permissions.map((rp: any) => rp.permission.key));
}
