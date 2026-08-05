import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantScopingExtension } from './prisma-tenant.extension';
import { tenantContextStorage, TenantContext } from './tenant-context';
import { tenantTxStorage } from './tenant-tx-context';

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
  get tenant(): PrismaClient {
    return (tenantTxStorage.getStore() as PrismaClient | undefined) ?? this.$extends(tenantScopingExtension());
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
    work: (tenantDb: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const extended = this.$extends(tenantScopingExtension());
    return tenantContextStorage.run(context, () =>
      extended.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL app.current_company_id = '${context.companyId}'`,
        );
        return tenantTxStorage.run(tx as unknown as PrismaClient, () => work(tx as unknown as PrismaClient));
      }),
    );
  }
}
