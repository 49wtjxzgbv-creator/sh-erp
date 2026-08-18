import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { CodedUnauthorizedException } from '../api-exceptions';

/**
 * Requires `req.user` (populated by TenantContextMiddleware) unless the
 * route carries `@Public()`. This is intentionally simple — actual token
 * verification already happened in the middleware; this guard just decides
 * whether the absence of a verified user should block the request.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    if (!request.user) {
      throw new CodedUnauthorizedException('AUTH_TOKEN_MISSING_OR_INVALID', 'Missing or invalid access token.');
    }
    return true;
  }
}
