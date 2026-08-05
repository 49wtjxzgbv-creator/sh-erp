import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface RequestUser {
  userId: string;
  companyId: string;
  email: string;
  roleId: string;
}

/** Pulls the authenticated user + resolved tenant off the request, set by TenantContextMiddleware. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
