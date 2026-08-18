import { Injectable, Logger } from '@nestjs/common';
import { CodedBadRequestException, CodedForbiddenException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportPairingPrismaService } from '../../prisma/import-pairing-prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { decryptApiKey, encryptApiKey } from '../ai/ai-crypto.util';
import { getImportProvider, listImportProviders } from './providers/provider.registry';
import type { ImportConnectorProvider } from './providers/provider.interface';
import { transformLegacyImport, type LegacyExportPayload } from './transform';
import { loadImportGraph } from './load';
import { buildImportReport, type ImportReport } from './report';
import { PhotoImportService } from './photo-import.service';
import { StartConnectionDto } from './dto/start-connection.dto';
import { CompletePairingDto } from './dto/complete-pairing.dto';
import { RunImportDto } from './dto/run-import.dto';
import { StartJobDto } from './dto/start-job.dto';

/**
 * Orchestrates the universal import platform: connections (device-pairing
 * handshake with a pluggable `ImportConnectorProvider`, see
 * `providers/provider.interface.ts`) and jobs (fetch -> transform -> load ->
 * report pipeline behind `ImportJob`, the same "durable row instead of
 * in-memory state" shape `PendingAiAction` already established for
 * long-running work in this codebase — ADR-0005: no Redis/BullMQ yet, an
 * in-process un-awaited async function with polled DB status).
 */
@Injectable()
export class LegacyImportService {
  private readonly logger = new Logger(LegacyImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pairingPrisma: ImportPairingPrismaService,
    private readonly auditService: AuditService,
    private readonly photoImportService: PhotoImportService,
  ) {}

  // ==========================================================================
  // Providers
  // ==========================================================================

  listProviders() {
    return listImportProviders();
  }

  // ==========================================================================
  // Connections
  // ==========================================================================

  async listConnections(user: RequestUser) {
    const connections = await this.prisma.tenant.importConnection.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: 'desc' },
    });
    return connections.map(sanitizeConnection);
  }

  async getConnection(user: RequestUser, id: string) {
    const connection = await this.prisma.tenant.importConnection.findUnique({ where: { id } });
    if (!connection) throw new CodedNotFoundException('IMPORT_CONNECTION_NOT_FOUND', 'Import connection not found.');
    return sanitizeConnection(connection);
  }

  /** Wizard "+ Додати джерело" — starts a new connection. For a pairing-style provider (Apps Script today) this only generates and stores a pairing code; nothing is fetched yet. */
  async startConnection(user: RequestUser, dto: StartConnectionDto) {
    const provider = getImportProvider(dto.providerType);
    const setup = await provider.initiateSetup({ companyId: user.companyId, userId: user.userId });

    const existingCount = await this.prisma.tenant.importConnection.count({ where: { companyId: user.companyId } });
    const label = dto.label?.trim() || `Джерело ${existingCount + 1}`;

    if (setup.requiresPairing) {
      const connection = await this.prisma.tenant.importConnection.create({
        data: {
          companyId: user.companyId,
          providerType: provider.type,
          label,
          status: 'PENDING',
          pairingCode: setup.pairingCode,
          pairingCodeExpiresAt: setup.expiresAt,
          createdByUserId: user.userId,
        },
      });
      return sanitizeConnection(connection);
    }

    const connection = await this.prisma.tenant.importConnection.create({
      data: {
        companyId: user.companyId,
        providerType: provider.type,
        label,
        status: 'PAIRED',
        configEncrypted: encryptApiKey(JSON.stringify(setup.config)),
        protocolVersion: setup.protocolVersion,
        connectorVersion: setup.connectorVersion,
        createdByUserId: user.userId,
        pairedAt: new Date(),
      },
    });
    return sanitizeConnection(connection);
  }

  /**
   * Public pairing endpoint handler — called by the connector itself
   * (anonymous, no JWT). Uses `ImportPairingPrismaService` (a narrowly
   * scoped, BYPASSRLS DB role — see that class's header comment) because
   * companyId is not known from the request; it's resolved purely from the
   * pairing code, mirroring `AuthService`'s pre-tenant-context pattern for
   * login/refresh.
   */
  async completePairing(dto: CompletePairingDto) {
    const connection = await this.pairingPrisma.importConnection.findFirst({ where: { pairingCode: dto.pairingCode } });
    if (!connection) throw new CodedNotFoundException('IMPORT_INVALID_PAIRING_CODE', 'Невірний код підключення.');
    if (connection.status !== 'PENDING') throw new CodedBadRequestException('IMPORT_PAIRING_CODE_USED', 'Цей код підключення вже використано.');
    if (!connection.pairingCodeExpiresAt || connection.pairingCodeExpiresAt.getTime() < Date.now()) {
      throw new CodedBadRequestException('IMPORT_PAIRING_CODE_EXPIRED', 'Код підключення прострочено — згенеруйте новий у SH ERP.');
    }

    const provider = getImportProvider(connection.providerType);
    const { config, protocolVersion, connectorVersion, responseBody } = await provider.completeSetup(dto);

    await this.pairingPrisma.importConnection.update({
      where: { id: connection.id },
      data: {
        status: 'PAIRED',
        configEncrypted: encryptApiKey(JSON.stringify(config)),
        protocolVersion,
        connectorVersion,
        pairingCode: null,
        pairingCodeExpiresAt: null,
        pairedAt: new Date(),
      },
    });

    // Best-effort — an immediate health check right after pairing gives the
    // wizard real diagnostics ("З'єднано ✓ — доступ до таблиці: так") without
    // a second manual step. Never blocks the pairing response on failure.
    this.runHealthCheckAndPersist(connection.companyId, connection.createdByUserId, connection.id, provider).catch((err) => {
      this.logger.warn(`Post-pairing health check failed for connection ${connection.id}: ${String(err)}`);
    });

    return responseBody;
  }

  async healthCheck(user: RequestUser, id: string) {
    const connection = await this.requireConnection(user, id);
    const provider = getImportProvider(connection.providerType);
    return this.runHealthCheckAndPersist(user.companyId, user.userId, id, provider);
  }

  /** Shared by the post-pairing auto-check (no RequestUser on hand — runs off the public pairing endpoint) and the on-demand "Перевірити з'єднання" button. `actorUserId` is only ever used to populate `runInTenantTransaction`'s context, never written anywhere. */
  private async runHealthCheckAndPersist(companyId: string, actorUserId: string, connectionId: string, provider: ImportConnectorProvider) {
    const connection = await this.prisma.runInTenantTransaction({ companyId, userId: actorUserId }, (tx) =>
      tx.importConnection.findUnique({ where: { id: connectionId } }),
    );
    if (!connection?.configEncrypted) throw new CodedNotFoundException('IMPORT_CONNECTION_NOT_PAIRED', 'Import connection not found or not paired.');

    const config = JSON.parse(decryptApiKey(connection.configEncrypted));
    const health = await provider.checkHealth(config);

    await this.prisma.runInTenantTransaction({ companyId, userId: actorUserId }, (tx) =>
      tx.importConnection.update({
        where: { id: connectionId },
        data: {
          lastHealthCheckAt: new Date(),
          lastHealthStatus: health as never,
          protocolVersion: health.protocolVersion ?? connection.protocolVersion,
          connectorVersion: health.providerVersion ?? connection.connectorVersion,
        },
      }),
    );

    return health;
  }

  /** Disconnects a source: SH ERP forgets the credential immediately (soft revoke) and best-effort asks the provider's remote side to forget it too (hard revoke, capability-dependent). */
  async revokeConnection(user: RequestUser, id: string) {
    const connection = await this.requireConnection(user, id);
    if (connection.configEncrypted) {
      const provider = getImportProvider(connection.providerType);
      const config = JSON.parse(decryptApiKey(connection.configEncrypted));
      await provider.revoke(config).catch(() => undefined); // never blocks local revoke, see provider.interface.ts's contract
    }

    const updated = await this.prisma.tenant.importConnection.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date(), configEncrypted: null },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'legacy_import.connection_revoked',
      entityType: 'ImportConnection',
      entityId: id,
    });

    return sanitizeConnection(updated);
  }

  /** Reconnects a REVOKED (or still-PENDING) connection without recreating the Apps Script project: same connection row, fresh pairing code. */
  async reconnectConnection(user: RequestUser, id: string) {
    const connection = await this.requireConnection(user, id);
    const provider = getImportProvider(connection.providerType);
    const setup = await provider.initiateSetup({ companyId: user.companyId, userId: user.userId });
    if (!setup.requiresPairing) {
      throw new CodedBadRequestException('IMPORT_RECONNECT_NOT_SUPPORTED', 'Цей тип джерела не потребує повторного підключення.');
    }

    const updated = await this.prisma.tenant.importConnection.update({
      where: { id },
      data: {
        status: 'PENDING',
        pairingCode: setup.pairingCode,
        pairingCodeExpiresAt: setup.expiresAt,
        configEncrypted: null,
      },
    });
    return sanitizeConnection(updated);
  }

  // ==========================================================================
  // Jobs
  // ==========================================================================

  /** Dry-run — fetch + transform against a PAIRED connection, no database writes at all, returned synchronously in the same request. */
  async validate(user: RequestUser, dto: RunImportDto): Promise<ImportReport> {
    const connection = await this.requireConnection(user, dto.connectionId);
    const provider = getImportProvider(connection.providerType);
    const config = this.decryptConfig(connection);

    const payload = await provider.fetchData(config);
    const existingIdMaps = await this.loadExistingIdMaps(user);
    const graph = transformLegacyImport(payload, { companyId: user.companyId, actorUserId: user.userId, ...existingIdMaps });

    return buildImportReport(this.prisma, user.companyId, user.userId, payload, graph, {
      protocolVersion: connection.protocolVersion ?? undefined,
      connectorVersion: connection.connectorVersion ?? undefined,
    });
  }

  /**
   * Starts the real import as a background job, returns immediately so the
   * wizard can redirect to the progress screen. For a real (non-dry-run)
   * import, synchronously re-fetches and re-transforms first and REFUSES
   * to create the job at all if that produces blocking errors — "import
   * blocked while critical errors exist" is enforced here, server-side,
   * not only via a disabled button in the UI, and never trusts a possibly
   * stale client-side report from an earlier "Перевірити" call. A dry-run
   * job is always allowed to start regardless — its whole purpose is
   * letting the user see what the errors are.
   */
  async startImport(user: RequestUser, dto: StartJobDto) {
    const connection = await this.requireConnection(user, dto.connectionId);

    if (!dto.dryRun) {
      const provider = getImportProvider(connection.providerType);
      const config = this.decryptConfig(connection);
      const payload = await provider.fetchData(config);
      const existingIdMaps = await this.loadExistingIdMaps(user);
      const graph = transformLegacyImport(payload, { companyId: user.companyId, actorUserId: user.userId, ...existingIdMaps });
      const report = await buildImportReport(this.prisma, user.companyId, user.userId, payload, graph, {
        protocolVersion: connection.protocolVersion ?? undefined,
        connectorVersion: connection.connectorVersion ?? undefined,
      });
      if (report.errors.length > 0) {
        throw new CodedBadRequestException(
          'IMPORT_BLOCKED_BY_ERRORS',
          `Імпорт заблоковано через критичні помилки: ${report.errors.map((e) => e.message).join(' ')}`,
        );
      }
    }

    const job = await this.prisma.tenant.importJob.create({
      data: {
        companyId: user.companyId,
        connectionId: connection.id,
        status: 'PENDING',
        dryRun: dto.dryRun ?? false,
        startedByUserId: user.userId,
      },
    });

    // Deliberately not awaited — see class header comment. Errors inside
    // are caught and persisted onto the job row itself (runImportJob's own
    // try/catch), never left to become an unhandled rejection.
    void this.runImportJob(job.id, user.companyId, user.userId, connection.id, dto.dryRun ?? false);

    return job;
  }

  async getJob(user: RequestUser, id: string) {
    const job = await this.prisma.tenant.importJob.findUnique({ where: { id } });
    if (!job) throw new CodedNotFoundException('IMPORT_JOB_NOT_FOUND', 'Import job not found.');
    return job;
  }

  async listJobs(user: RequestUser, connectionId?: string) {
    return this.prisma.tenant.importJob.findMany({
      where: { companyId: user.companyId, ...(connectionId ? { connectionId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  private async runImportJob(
    jobId: string,
    companyId: string,
    actorUserId: string,
    connectionId: string,
    dryRun: boolean,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      const connection = await this.readConnection(companyId, actorUserId, connectionId);
      if (!connection?.configEncrypted) throw new CodedBadRequestException('IMPORT_SOURCE_NOT_CONNECTED', 'Джерело не підключено.');
      const provider = getImportProvider(connection.providerType);
      const config = JSON.parse(decryptApiKey(connection.configEncrypted));

      await this.updateJob(companyId, actorUserId, jobId, { status: 'FETCHING', step: 'fetching' });
      const payload: LegacyExportPayload = await provider.fetchData(config);

      await this.updateJob(companyId, actorUserId, jobId, { status: 'TRANSFORMING', step: 'transforming' });
      const existingIdMaps = await this.readExistingIdMaps(companyId, actorUserId);
      const graph = transformLegacyImport(payload, { companyId, actorUserId, ...existingIdMaps });

      const report = await buildImportReport(this.prisma, companyId, actorUserId, payload, graph, {
        protocolVersion: connection.protocolVersion ?? undefined,
        connectorVersion: connection.connectorVersion ?? undefined,
      });

      if (!dryRun && report.errors.length > 0) {
        throw new CodedBadRequestException(
          'IMPORT_BLOCKED_BY_ERRORS',
          `Імпорт заблоковано через критичні помилки: ${report.errors.map((e) => e.message).join(' ')}`,
        );
      }

      if (dryRun) {
        await this.updateJob(companyId, actorUserId, jobId, {
          status: 'COMPLETED',
          step: null,
          warnings: graph.warnings as never,
          errors: report.errors as never,
          report: { ...report, durationMs: Date.now() - startedAt } as never,
          durationMs: Date.now() - startedAt,
          completedAt: new Date(),
        });
        return;
      }

      await this.updateJob(companyId, actorUserId, jobId, { status: 'LOADING', step: 'loading' });
      const { counts, skippedLedgers } = await loadImportGraph(this.prisma, companyId, actorUserId, graph);

      let photosMissing = 0;
      if (graph.photoRefs.length > 0) {
        await this.updateJob(companyId, actorUserId, jobId, {
          status: 'IMPORTING_PHOTOS',
          step: 'importing_photos',
          totalPhotos: graph.photoRefs.length,
          processedPhotos: 0,
        });
        const photoSummary = await this.photoImportService.importPhotos(
          companyId,
          actorUserId,
          provider,
          config,
          graph.photoRefs,
          (processed) => this.updateJob(companyId, actorUserId, jobId, { processedPhotos: processed }),
        );
        photosMissing = photoSummary.failed + photoSummary.skippedMissingEntity;
      }

      const finalReport: ImportReport = { ...report, loadedCounts: counts, skippedLedgers, photosMissing, durationMs: Date.now() - startedAt };
      await this.updateJob(companyId, actorUserId, jobId, {
        status: 'COMPLETED',
        step: null,
        warnings: graph.warnings as never,
        errors: report.errors as never,
        report: finalReport as never,
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      });

      await this.prisma.runInTenantTransaction({ companyId, userId: actorUserId }, async () => {
        await this.auditService.record({
          companyId,
          actorUserId,
          action: 'legacy_import.completed',
          entityType: 'ImportJob',
          entityId: jobId,
          metadata: { loadedCounts: counts, warningCount: graph.warnings.length },
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Import job ${jobId} failed: ${message}`, err instanceof Error ? err.stack : undefined);
      await this.updateJob(companyId, actorUserId, jobId, {
        status: 'FAILED',
        step: null,
        errorMessage: message,
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      }).catch((updateErr) => {
        this.logger.error(`Import job ${jobId} also failed to persist its own failure status: ${String(updateErr)}`);
      });
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private async requireConnection(user: RequestUser, id: string) {
    const connection = await this.prisma.tenant.importConnection.findUnique({ where: { id } });
    if (!connection) throw new CodedNotFoundException('IMPORT_CONNECTION_NOT_FOUND', 'Import connection not found.');
    return connection;
  }

  private decryptConfig(connection: { configEncrypted: string | null; status: string }): unknown {
    if (connection.status !== 'PAIRED' || !connection.configEncrypted) {
      throw new CodedForbiddenException('IMPORT_NOT_CONNECTED', 'Це джерело ще не підключено — спочатку завершіть підключення.');
    }
    return JSON.parse(decryptApiKey(connection.configEncrypted));
  }

  private async readConnection(companyId: string, actorUserId: string, connectionId: string) {
    return this.prisma.runInTenantTransaction({ companyId, userId: actorUserId }, (tx) =>
      tx.importConnection.findUnique({ where: { id: connectionId } }),
    );
  }

  /**
   * Every "legacyId (or name, for units) -> id" map `transformLegacyImport`
   * needs to know what ALREADY exists in this company, for EVERY
   * legacyId-keyed entity type — not just units. Real incident this fixes:
   * without this, a re-run against a company that already has data loaded
   * generates a FRESH `randomUUID()` for an already-existing row's id;
   * `load.ts` upserts by `(companyId, legacyId)`, so that fresh id is
   * silently discarded for the row itself (the update branch never touches
   * `id`), but any OTHER entity referencing it via a legacyId-resolved FK
   * (e.g. `Product.defaultSupplierId`) still points at the discarded,
   * never-persisted id — `products_defaultSupplierId_fkey` was exactly
   * this, and the same class of bug applies to every other cross-reference
   * in `transform/index.ts` (products, warehouses, assemblies,
   * customerOrders all have at least one downstream FK resolved the same
   * way).
   */
  private async loadExistingIdMaps(user: RequestUser): Promise<ExistingIdMaps> {
    const companyId = user.companyId;
    // Every row of each type, not just legacyId-having ones — see
    // #existingProductIdByArticle's comment (the same "already exists from
    // manual entry / a non-legacy-import source" collision applies to
    // warehouses/suppliers/assemblies too, not just products; the warehouse
    // one is a real, confirmed second incident: the SAME company's single
    // pre-existing "Основний склад" — no legacyId, isDefault — collided
    // with the unique-default-warehouse-per-company index the moment a run
    // tried to CREATE a "new" default warehouse instead of recognizing it).
    const [units, suppliers, products, warehouses, assemblies, customerOrders] = await Promise.all([
      this.prisma.tenant.companyUnit.findMany({ where: { companyId } }),
      this.prisma.tenant.supplier.findMany({ where: { companyId } }),
      this.prisma.tenant.product.findMany({ where: { companyId } }),
      this.prisma.tenant.warehouse.findMany({ where: { companyId } }),
      this.prisma.tenant.assembly.findMany({ where: { companyId } }),
      this.prisma.tenant.customerOrder.findMany({ where: { companyId, legacyId: { not: null } } }),
    ]);
    return buildExistingIdMaps({ units, suppliers, products, warehouses, assemblies, customerOrders });
  }

  /** Same reads, but explicit about tenant context — this is called from the un-awaited background job, not from inside a request, per `PrismaService`'s own guidance for code running outside a request lifecycle. */
  private async readExistingIdMaps(companyId: string, actorUserId: string): Promise<ExistingIdMaps> {
    return this.prisma.runInTenantTransaction({ companyId, userId: actorUserId }, async (tx) => {
      const [units, suppliers, products, warehouses, assemblies, customerOrders] = await Promise.all([
        tx.companyUnit.findMany({ where: { companyId } }),
        tx.supplier.findMany({ where: { companyId } }),
        tx.product.findMany({ where: { companyId } }),
        tx.warehouse.findMany({ where: { companyId } }),
        tx.assembly.findMany({ where: { companyId } }),
        tx.customerOrder.findMany({ where: { companyId, legacyId: { not: null } } }),
      ]);
      return buildExistingIdMaps({ units, suppliers, products, warehouses, assemblies, customerOrders });
    });
  }

  private async updateJob(companyId: string, actorUserId: string, jobId: string, data: Record<string, unknown>): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId, userId: actorUserId }, async (tx) => {
      await tx.importJob.update({ where: { id: jobId }, data: data as never });
    });
  }
}

/**
 * Never sends `configEncrypted` (the encrypted credential blob itself) to
 * the client. `pairingCode` is deliberately still returned — while a
 * connection is PENDING, the wizard needs to display it to the same
 * authenticated user who just generated it so they can type it into the
 * Sheet; it's already nulled out server-side the moment pairing completes,
 * so nothing sensitive is exposed once status is PAIRED.
 */
function sanitizeConnection<T extends { configEncrypted?: string | null }>(connection: T): Omit<T, 'configEncrypted'> {
  const { configEncrypted: _configEncrypted, ...rest } = connection;
  return rest;
}

/**
 * `existingXIdByLegacyId` alone treats any row that already exists WITHOUT
 * a legacyId (manually entered, or brought in through the separate Excel
 * import — neither ever sets one) as "doesn't exist yet," so `load.ts`
 * tried to CREATE a fresh duplicate and crashed on the entity's own natural
 * uniqueness — confirmed for two entities so far, real incidents both:
 * `products`'s `@@unique([companyId, article])`, and — worse — a
 * warehouse's `isDefault` colliding with the unique-default-warehouse-per-
 * company partial index the moment a run tried to CREATE a "new" default
 * warehouse next to the company's real one. Every legacyId-upserted entity
 * below gets the same fallback: resolve to whatever id the row will
 * ACTUALLY persist under (matched by article/name, each entity's own
 * "natural key" outside the legacyId system) before `transform/index.ts`
 * hands out a fresh `randomUUID()` for something that already exists.
 * `customerOrders` is deliberately NOT included — clientName isn't a
 * natural key (no uniqueness constraint on it at all, unlike the other
 * four), so there's no equivalent collision to fix there.
 */
interface ExistingIdMaps {
  existingUnitIdByName: Map<string, string>;
  existingSupplierIdByLegacyId: Map<string, string>;
  existingSupplierIdByName: Map<string, string>;
  existingProductIdByLegacyId: Map<string, string>;
  existingProductIdByArticle: Map<string, string>;
  existingWarehouseIdByLegacyId: Map<string, string>;
  existingWarehouseIdByName: Map<string, string>;
  existingAssemblyIdByLegacyId: Map<string, string>;
  existingAssemblyIdByArticleOrName: Map<string, string>;
  existingCustomerOrderIdByLegacyId: Map<string, string>;
}

/** Shared by `loadExistingIdMaps` (request-scoped) and `readExistingIdMaps` (background-job-scoped) — both fetch the same six row sets, just through different Prisma contexts, so the id -> map assembly itself is factored out once. */
function buildExistingIdMaps(rows: {
  units: { name: string; id: string }[];
  suppliers: { legacyId: string | null; id: string; name: string }[];
  products: { legacyId: string | null; id: string; article: string }[];
  warehouses: { legacyId: string | null; id: string; name: string }[];
  assemblies: { legacyId: string | null; id: string; article: string | null; name: string }[];
  customerOrders: { legacyId: string | null; id: string }[];
}): ExistingIdMaps {
  const byLegacyId = (items: { legacyId: string | null; id: string }[]) =>
    new Map(items.filter((i): i is { legacyId: string; id: string } => i.legacyId !== null).map((i) => [i.legacyId, i.id]));
  return {
    existingUnitIdByName: new Map(rows.units.map((u) => [u.name, u.id])),
    existingSupplierIdByLegacyId: byLegacyId(rows.suppliers),
    existingSupplierIdByName: new Map(rows.suppliers.map((s) => [s.name, s.id])),
    existingProductIdByLegacyId: byLegacyId(rows.products),
    existingProductIdByArticle: new Map(rows.products.map((p) => [p.article, p.id])),
    existingWarehouseIdByLegacyId: byLegacyId(rows.warehouses),
    existingWarehouseIdByName: new Map(rows.warehouses.map((w) => [w.name, w.id])),
    existingAssemblyIdByLegacyId: byLegacyId(rows.assemblies),
    existingAssemblyIdByArticleOrName: new Map(rows.assemblies.map((a) => [a.article ?? a.name, a.id])),
    existingCustomerOrderIdByLegacyId: byLegacyId(rows.customerOrders),
  };
}
