import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response, NextFunction } from 'express';
import { tenantContextStorage } from '../../prisma/tenant-context';

export interface AccessTokenPayload {
  sub: string; // userId
  companyId: string;
  email: string;
  roleId: string;
}

/**
 * Runs once per request, before routing. If a valid access token is
 * present, verifies it and populates BOTH `req.user` (read by guards /
 * @CurrentUser) and the AsyncLocalStorage tenant context (read by
 * PrismaService's tenant-scoping extension) for the remainder of the
 * request's async call chain — this is what makes `this.tenant.product.findMany()`
 * automatically scoped inside any service, without passing companyId
 * through every function signature by hand.
 *
 * Deliberately does NOT reject the request if the token is missing or
 * invalid — that's JwtAuthGuard's job (so `@Public()` routes, like login,
 * still work). This middleware only ever adds context; it never blocks.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      return next();
    }

    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token);
      (req as any).user = {
        userId: payload.sub,
        companyId: payload.companyId,
        email: payload.email,
        roleId: payload.roleId,
      };
      tenantContextStorage.run(
        { companyId: payload.companyId, userId: payload.sub },
        () => next(),
      );
    } catch {
      // Invalid/expired token: leave req.user unset. JwtAuthGuard turns
      // this into a 401 for any non-@Public() route.
      next();
    }
  }
}
