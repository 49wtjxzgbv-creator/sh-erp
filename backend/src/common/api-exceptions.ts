import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';

/**
 * Every business-logic exception thrown across the backend used to carry
 * only a hardcoded English `message` — the frontend displayed that string
 * verbatim regardless of the user's selected interface language (uk/en/pl/
 * de). Fixed by adding a stable, machine-readable `code` alongside the
 * (still-present, English) message: the frontend's `useApiErrorMessage()`
 * (frontend/lib/api-error-message.ts) looks the code up in a translated
 * `apiErrors` message namespace and falls back to the raw English message
 * only for exceptions that haven't been migrated to a coded variant yet
 * (plain `throw new BadRequestException('...')`, or class-validator's own
 * generated DTO validation strings, which have no single stable code to
 * translate against).
 *
 * `extra` is merged into the response body alongside `code`/`message` —
 * needed for the handful of exceptions that also carry structured data a
 * caller inspects (e.g. `shortages` on production-order start / BOM
 * produce failures).
 */
export class CodedBadRequestException extends BadRequestException {
  constructor(code: string, message: string, extra?: Record<string, unknown>) {
    super({ code, message, ...extra });
  }
}

export class CodedConflictException extends ConflictException {
  constructor(code: string, message: string, extra?: Record<string, unknown>) {
    super({ code, message, ...extra });
  }
}

export class CodedNotFoundException extends NotFoundException {
  constructor(code: string, message: string, extra?: Record<string, unknown>) {
    super({ code, message, ...extra });
  }
}

export class CodedForbiddenException extends ForbiddenException {
  constructor(code: string, message: string, extra?: Record<string, unknown>) {
    super({ code, message, ...extra });
  }
}

export class CodedUnauthorizedException extends UnauthorizedException {
  constructor(code: string, message: string, extra?: Record<string, unknown>) {
    super({ code, message, ...extra });
  }
}

export class CodedUnprocessableEntityException extends UnprocessableEntityException {
  constructor(code: string, message: string, extra?: Record<string, unknown>) {
    super({ code, message, ...extra });
  }
}
