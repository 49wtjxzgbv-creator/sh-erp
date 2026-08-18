import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CodedUnauthorizedException } from '../../common/api-exceptions';

export interface RequestSuperAdmin {
  superAdminId: string;
  email: string;
}

export interface SuperAdminTokenPayload {
  sub: string;
  email: string;
  type: 'super_admin'; // distinguishes this token from a regular access token at a glance if ever logged/inspected
}

/**
 * Full separation from the regular auth pipeline, per the explicit
 * "Company Admin і Super Admin повинні бути повністю різними ролями... мати
 * окрему авторизацію" requirement: this guard does its OWN JWT
 * verification, with its OWN secret (`SUPER_ADMIN_JWT_SECRET`, never
 * `JWT_ACCESS_SECRET`), independent of `TenantContextMiddleware`/
 * `JwtAuthGuard`/`TenantScopeInterceptor` entirely. Every controller this
 * guards MUST also carry `@Public()` — that's what keeps the regular
 * pipeline from 401-ing the request before this guard even runs (a
 * super-admin token fails regular verification, by design, since it's
 * signed with a different secret — `TenantContextMiddleware` already
 * treats a verify failure as "no user", not an error, so this is a
 * deliberate, harmless non-interaction, not a bypass of anything).
 *
 * Reuses the shared `JwtService` (from `@nestjs/jwt`) rather than a second
 * `JwtModule` registration — `sign()`/`verify()` both accept a `secret`
 * override per call, which is all a second, fully independent secret
 * actually needs.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new CodedUnauthorizedException('SUPER_ADMIN_TOKEN_MISSING', 'Missing super-admin access token.');
    }

    const secret = process.env.SUPER_ADMIN_JWT_SECRET;
    if (!secret) {
      // Fail closed, loudly — an unset secret must never silently fall
      // back to the regular JWT_ACCESS_SECRET (that would let a normal
      // Company Admin's token double as a Super Admin token, exactly the
      // "completely different roles" boundary this feature exists to
      // guarantee).
      throw new CodedUnauthorizedException(
        'SUPER_ADMIN_AUTH_DISABLED',
        'SUPER_ADMIN_JWT_SECRET is not configured on this server — Super Admin auth is disabled until it is set.',
      );
    }

    try {
      const payload = this.jwt.verify<SuperAdminTokenPayload>(token, { secret });
      if (payload.type !== 'super_admin') {
        throw new Error('wrong token type');
      }
      request.superAdmin = { superAdminId: payload.sub, email: payload.email } satisfies RequestSuperAdmin;
      return true;
    } catch {
      throw new CodedUnauthorizedException('SUPER_ADMIN_TOKEN_INVALID', 'Invalid or expired super-admin access token.');
    }
  }
}

/** Pulls the authenticated super admin off the request, set by SuperAdminGuard. */
export const CurrentSuperAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestSuperAdmin => {
    const request = ctx.switchToHttp().getRequest();
    return request.superAdmin;
  },
);
