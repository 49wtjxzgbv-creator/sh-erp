import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { decryptApiKey, encryptApiKey } from '../ai/ai-crypto.util';
import { AppsScriptClient } from './apps-script-client';
import { transformLegacyImport, type LegacyExportPayload } from './transform';
import { loadImportGraph } from './load';
import { StartImportDto } from './dto/start-import.dto';

/**
 * Orchestrates the 4-stage SHСклад import pipeline (fetch -> transform ->
 * load -> report) behind `ImportJob`, the same "durable row instead of
 * in-memory state" shape `PendingAiAction` already established for
 * long-running work in this codebase (ADR-0005: no Redis/BullMQ yet — an
 * in-process, un-awaited async function with polled DB status, not a real
 * job queue). See legacy-import.controller.ts for the request-time API and
 * transform/index.ts's header comment for what entity set this v1 covers.
 */
@Injectable()
export class LegacyImportService {
  private readonly logger = new Logger(LegacyImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Wizard step 2 ("Перевірити") — fetch + transform only, no DB writes at all, returned synchronously in the same request. */
  async validate(user: RequestUser, dto: StartImportDto) {
    const payload = await this.fetchPayload(dto.sourceUrl, dto.sourceToken);
    const existingUnitIdByName = await this.loadExistingUnitMap(user);
    const graph = transformLegacyImport(payload, { companyId: user.companyId, actorUserId: user.userId, existingUnitIdByName });
    return {
      report: buildReport(graph),
      warnings: graph.warnings,
    };
  }

  /** Wizard step 3 ("Імпортувати") — creates the ImportJob row and starts the real pipeline in the background, returning immediately so the wizard can redirect to the progress screen. */
  async startImport(user: RequestUser, dto: StartImportDto) {
    const job = await this.prisma.tenant.importJob.create({
      data: {
        companyId: user.companyId,
        status: 'PENDING',
        sourceUrl: dto.sourceUrl,
        sourceTokenEncrypted: encryptApiKey(dto.sourceToken),
        dryRun: dto.dryRun ?? false,
        startedByUserId: user.userId,
      },
    });

    // Deliberately not awaited — see class header comment. Errors inside
    // are caught and persisted onto the job row itself (runImportJob's own
    // try/catch), never left to become an unhandled rejection.
    void this.runImportJob(job.id, user.companyId, user.userId, dto.sourceUrl, dto.sourceToken, dto.dryRun ?? false);

    return job;
  }

  async getJob(user: RequestUser, id: string) {
    const job = await this.prisma.tenant.importJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Import job not found.');
    return job;
  }

  async listJobs(user: RequestUser) {
    return this.prisma.tenant.importJob.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  private async runImportJob(
    jobId: string,
    companyId: string,
    actorUserId: string,
    sourceUrl: string,
    sourceToken: string,
    dryRun: boolean,
  ): Promise<void> {
    try {
      await this.updateJob(companyId, actorUserId, jobId, { status: 'FETCHING', step: 'fetching' });
      const payload = await this.fetchPayloadRaw(sourceUrl, sourceToken);

      await this.updateJob(companyId, actorUserId, jobId, { status: 'TRANSFORMING', step: 'transforming' });
      const existingUnitIdByName = await this.readExistingUnitMap(companyId, actorUserId);
      const graph = transformLegacyImport(payload, { companyId, actorUserId, existingUnitIdByName });

      if (dryRun) {
        await this.updateJob(companyId, actorUserId, jobId, {
          status: 'COMPLETED',
          step: null,
          report: buildReport(graph) as never,
          warnings: graph.warnings as never,
          completedAt: new Date(),
        });
        return;
      }

      await this.updateJob(companyId, actorUserId, jobId, { status: 'LOADING', step: 'loading' });
      const { counts, skippedLedgers } = await loadImportGraph(this.prisma, companyId, actorUserId, graph);

      const report = { ...buildReport(graph), loadedCounts: counts, skippedLedgers };
      await this.updateJob(companyId, actorUserId, jobId, {
        status: 'COMPLETED',
        step: null,
        report: report as never,
        warnings: graph.warnings as never,
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
        completedAt: new Date(),
      }).catch((updateErr) => {
        this.logger.error(`Import job ${jobId} also failed to persist its own failure status: ${String(updateErr)}`);
      });
    }
  }

  private async fetchPayload(sourceUrl: string, sourceToken: string): Promise<LegacyExportPayload> {
    return this.fetchPayloadRaw(sourceUrl, sourceToken);
  }

  private async fetchPayloadRaw(sourceUrl: string, sourceToken: string): Promise<LegacyExportPayload> {
    const client = new AppsScriptClient(sourceUrl, sourceToken);
    return client.fetchData();
  }

  /** Reads the requesting user's already-existing CompanyUnit rows, inside the normal request's RLS context. */
  private async loadExistingUnitMap(user: RequestUser): Promise<Map<string, string>> {
    const units = await this.prisma.tenant.companyUnit.findMany({ where: { companyId: user.companyId } });
    return new Map(units.map((u) => [u.name, u.id]));
  }

  /** Same read, but explicit about tenant context — this is called from the un-awaited background job, not from inside a request, per PrismaService's own guidance for code running outside a request lifecycle. */
  private async readExistingUnitMap(companyId: string, actorUserId: string): Promise<Map<string, string>> {
    return this.prisma.runInTenantTransaction({ companyId, userId: actorUserId }, async (tx) => {
      const units = await tx.companyUnit.findMany({ where: { companyId } });
      return new Map(units.map((u) => [u.name, u.id]));
    });
  }

  private async updateJob(companyId: string, actorUserId: string, jobId: string, data: Record<string, unknown>): Promise<void> {
    await this.prisma.runInTenantTransaction({ companyId, userId: actorUserId }, async (tx) => {
      await tx.importJob.update({ where: { id: jobId }, data: data as never });
    });
  }
}

function buildReport(graph: ReturnType<typeof transformLegacyImport>) {
  return {
    counts: {
      newUnits: graph.newUnits.length,
      products: graph.products.filter((p) => p.unitId).length,
      productsExcluded: graph.products.filter((p) => !p.unitId).length,
      suppliers: graph.suppliers.length,
      warehouses: graph.warehouses.length,
      warehouseStock: graph.warehouseStock.length,
      assemblies: graph.assemblies.length,
      assemblyComponents: graph.assemblyComponents.length,
      assemblyVersions: graph.assemblyVersions.length,
      customerOrders: graph.customerOrders.length,
      customerOrderItems: graph.customerOrderItems.length,
      stockMovements: graph.stockMovements.length,
      auditEvents: graph.auditEvents.length,
      photosDiscovered: graph.photoRefs.length,
    },
    warningCount: graph.warnings.length,
  };
}

// decryptApiKey is re-exported from here for Phase 3's photo-import pass (reads ImportJob.sourceTokenEncrypted back out) — kept as a named re-export rather than a second import site scattered elsewhere.
export { decryptApiKey };
