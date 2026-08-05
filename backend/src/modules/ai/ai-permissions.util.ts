/**
 * MOVED (production-readiness pass, Excel import/export build): this
 * function's only real logic now lives in
 * `src/common/authorization/permission-set.util.ts`, since a second,
 * non-AI caller (`ProductsImportExportService`, for gating export price
 * columns behind `reports:valuation`) needed the exact same
 * Role→RolePermission→Permission lookup and there was never anything
 * AI-specific about it. This file could not be deleted outright from this
 * sandbox (mounted-filesystem `rm` restriction), so it's kept as a
 * pure re-export rather than a duplicate implementation — every real
 * caller in this module already imports directly from the new location
 * (see `ai.service.ts`/`ai-actions.service.ts`); nothing new should import
 * from here.
 */
export { loadPermissionSet } from '../../common/authorization/permission-set.util';
