import type { Request } from 'express';

/**
 * "Хто заходить в програму з якого IP та пристрою" (Super Admin, 2026-09-16
 * user request) — the one place that reads a client's real IP + User-Agent
 * off an incoming request, reused by every call site that mints a session
 * (`AuthController#login`/`refresh`, `CompaniesAdminController#impersonate`).
 * `req.ip` resolves to the REAL client IP (not the Nginx reverse proxy's
 * own) only because `main.ts` sets Express's `trust proxy` — see that
 * file's own comment for why. `device` stores the raw User-Agent string
 * as-is; parsing it into a friendly "Chrome on Windows" label is a display
 * concern (see login-sessions-admin.service.ts's own `parseUserAgent`), not
 * something to normalize away at capture time.
 */
export function getClientMeta(req: Request): { ip: string | undefined; device: string | undefined } {
  return {
    ip: req.ip,
    device: req.headers['user-agent'],
  };
}
