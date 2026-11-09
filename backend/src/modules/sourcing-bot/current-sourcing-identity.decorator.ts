import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ResolvedSourcingIdentity } from './sourcing-identity.service';

/** Mirrors `CurrentUser` (`src/common/decorators/current-user.decorator.ts`) — pulls the identity `TelegramWebAppAuthGuard` resolved and set on the request. */
export const CurrentSourcingIdentity = createParamDecorator((_data: unknown, ctx: ExecutionContext): ResolvedSourcingIdentity => {
  const request = ctx.switchToHttp().getRequest();
  return request.sourcingIdentity;
});
