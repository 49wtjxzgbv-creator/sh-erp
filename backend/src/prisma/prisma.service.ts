import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantScopingExtension } from './prisma-tenant.extension';
import { tenantContextStorage, TenantContext } from './tenant-context';
import { tenantTxStorage } from './tenant-tx-context';

/**
 * Root cause of a real Docker-build failure (TS2322 on `PrismaService.tenant`,
 * found once `prisma generate` finally ran against a real schema in a real
 * environment — see docs/readiness-report.md's "genuinely unverified"
 * section, which flagged exactly this class of gap in advance): `client.$extends(...)`
 * is a GENERIC method, and its real return type
 * (`Prisma.DynamicClientExtensionThis<...>`, computed from the specific
 * extension passed in) is a distinct, more specific type than plain
 * `PrismaClient` — NOT assignable to it. Every place in this file that used
 * to say `PrismaClient` for a value that might actually be an extended
 * client was therefore wrong, just never caught, because the hand-rolled
 * `@prisma/client` stub used for verification before a real `prisma
 * generate` was ever reachable modeled `$extends()` too loosely to expose
 * the mismatch.
 *
 * Fix follows Prisma's own documented pattern for typing an extended
 * client: route `$extends()` through a small NON-generic helper function,
 * then capture its type with `ReturnType<typeof helper>`.
 * `ReturnType<PrismaClient['$extends']>` does NOT work here — `$extends` is
 * itself generic, so referencing it as a bare method type erases the
 * specific extension argument and resolves to something unusable.
 */
function extendWithTenantScoping(client: PrismaClient) {
  return client.$extends(tenantScopingExtension());
}
export type TenantPrismaClient = ReturnType<typeof extendWithTenantScoping>;

/**
 * Base Prisma client, extended once with the app-layer tenant-scoping
 * extension (prisma-tenant.extension.ts). Every module should inject this
 * service rather than instantiating PrismaClient directly.
 *
 * Two-layer tenant isolation (ADR-0002):
 *   - App layer: the `tenantScopingExtension` (auto-inject/validate `companyId`).
 *   - DB layer: Postgres RLS (database-schema.md §2), activated by
 *     `SET LOCAL app.current_company_id` inside a transaction.
 * `TenantScopeInterceptor` (../common/interceptors/tenant-scope.interceptor.ts)
 * opens exactly one such transaction per authenticated request and stores
 * the resulting, still-extended client in `tenantTxStorage`. The `tenant`
 * getter below transparently resolves to that request-scoped client when
 * one exists, so every service written against `this.prisma.tenant.X` is
 * automatically RLS-correct without knowing anything about transactions.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Tenant-scoped client. Inside a request handled by TenantScopeInterceptor,
   * this is the RLS-activated transaction client for that request. Outside
   * a request (a script, a test that injects tenant context manually, or a
   * background job — see the Phase 4 migration engine's own tenant-context
   * handling), this falls back to a fresh, non-transactional extended
   * client: correct for the app-layer guarantee, but WITHOUT the RLS
   * backstop, since there is no request lifecycle to hang a transaction
   * off of. Any code running outside a request that needs the RLS backstop
   * too should use `runInTenantTransaction` explicitly instead.
   */
  get tenant(): TenantPrismaClient {
    return tenantTxStorage.getStore() ?? extendWithTenantScoping(this);
  }

  /**
   * Opens the RLS-activated transaction and runs `work` inside it, with
   * BOTH AsyncLocalStorage contexts populated so nested `this.tenant`
   * lookups inside `work` resolve consistently. This is what
   * TenantScopeInterceptor calls once per request; also usable directly by
   * anything running outside a request (background jobs, the migration
   * engine) that still needs the full two-layer guarantee.
   */
  async runInTenantTransaction<T>(
    context: TenantContext,
    work: (tenantDb: TenantPrismaClient) => Promise<T>,
  ): Promise<T> {
    const extended = extendWithTenantScoping(this);
    return tenantContextStorage.run(context, () =>
      extended.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL app.current_company_id = '${context.companyId}'`,
          );
          // `tx` here is Prisma's own interactive-transaction client shape for
          // an extended PrismaClient — structurally compatible with
          // TenantPrismaClient for every model-delegate call this codebase
          // actually makes (`tx.role.findUnique`, `tx.company.create`, etc.),
          // but not nominally identical to it, so this cast (pre-existing,
          // just retargeted from `PrismaClient` to the correct
          // `TenantPrismaClient`) stays.
          return tenantTxStorage.run(tx as unknown as TenantPrismaClient, () => work(tx as unknown as TenantPrismaClient));
        },
        // `TenantScopeInterceptor` opens one of these per request, wrapping
        // the whole handler -- including any slow external calls a handler
        // makes (e.g. legacy-import's fetch against a customer's Google
        // Apps Script Web App, which can legitimately take many seconds for
        // a real spreadsheet). Prisma's own interactive-transaction default
        // is only 5000ms, counted from BEGIN, so any such request blew past
        // it and every DB query after the slow call failed with "Transaction
        // already closed" -- a real incident this raises the ceiling for,
        // not a per-call tuning knob (ordinary fast requests still commit in
        // milliseconds either way).
        { timeout: 60000 },
      ),
    );
  }
}
