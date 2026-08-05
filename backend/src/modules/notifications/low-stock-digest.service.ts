import { Injectable, Logger } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';

const FORECAST_LOOKBACK_DAYS = 60; // same window as the AI assistant's forecastPurchaseNeeds tool — one consumption-rate calculation, reused conceptually in both places
const DIGEST_FORECAST_HORIZON_DAYS = 14; // matches dailyLowStockDigest_'s own cutoff exactly (narrower than the AI tool's 30-day reorder-quantity horizon — this digest only warns about what's genuinely imminent)

export interface LowStockDigestContent {
  subject: string;
  body: string;
  lowStockCount: number;
  imminentForecastCount: number;
}

/**
 * Ported from `dailyLowStockDigest_` (Automation.gs, Phase 1's Automation
 * section). Builds and (optionally) sends the same two-part digest: products
 * currently below `minQty`, plus products projected to run out within
 * `DIGEST_FORECAST_HORIZON_DAYS` days at their trailing 60-day consumption
 * rate. `CompanySettings.dailyDigestEnabled`/`dailyDigestEmail` (Module 3)
 * are the exact v2 equivalent of the legacy `DailyDigestEmail` Settings row
 * — this service reads them rather than reintroducing separate storage.
 *
 * Telegram mirroring (`tgNotifyAdmins_` in the legacy version) is
 * deliberately NOT ported — Telegram was explicitly deprioritized for the
 * initial SaaS build (Phase 0 decision).
 *
 * Scheduling gap, disclosed rather than faked: the legacy trigger ran this
 * automatically every day at 8am. No BullMQ/Redis job queue is wired into
 * this codebase yet (Phase 2 §9, not built in any module through Module 12)
 * — so `sendDigestForCompany` is callable on demand (see
 * `NotificationsController`'s `POST .../send-now`) but nothing calls it on
 * a schedule yet. `runForAllOptedInCompanies` (the batch entry point a real
 * cron job would call) is intentionally NOT implemented here: it would need
 * to enumerate `CompanySettings` across every company, which is a
 * cross-tenant read no current DB role can do — `app_user` is RLS-bound to
 * one company per request, and `auth_service` (ADR-0009) was approved with
 * a narrow, explicitly pre-tenant-auth-only grant list that does not
 * include `company_settings`. Building real scheduling requires an
 * architecture-level decision (most likely a new, similarly narrow
 * BYPASSRLS role for a background-job process, mirroring `auth_service`'s
 * own pattern) that hasn't been made — flagged for the project owner rather
 * than silently expanding `auth_service`'s already-approved grant list.
 */
@Injectable()
export class LowStockDigestService {
  private readonly logger = new Logger(LowStockDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async buildDigestContent(): Promise<LowStockDigestContent> {
    const products = await this.prisma.tenant.product.findMany({ where: { deletedAt: null } });
    const lowStock = products
      .filter((p) => Number(p.minQty) > 0 && Number(p.qty) < Number(p.minQty))
      .map((p) => ({ article: p.article, name: p.name, qty: Number(p.qty), minQty: Number(p.minQty) }));

    const cutoff = new Date(Date.now() - FORECAST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const movements = await this.prisma.tenant.stockMovement.findMany({
      where: { createdAt: { gte: cutoff }, qtyDelta: { lt: 0 } },
    });
    const consumptionByProduct = new Map<string, number>();
    for (const m of movements) {
      consumptionByProduct.set(m.productId, (consumptionByProduct.get(m.productId) ?? 0) + Math.abs(Number(m.qtyDelta)));
    }
    // new Map(arr.map(p => [p.id, p])) loses tuple-type inference (a
    // recurring pitfall in this codebase — see purchase-orders.service.ts's
    // and customer-order-shortage.service.ts's own comments on the same
    // issue) — explicit Map<string, any> + for-loop instead.
    const productById = new Map<string, any>();
    for (const p of products as any[]) productById.set(p.id, p);

    const imminentForecast: Array<{ article: string; name: string; daysUntilEmpty: number; suggestedOrderQty: number }> = [];
    for (const [productId, totalOut] of consumptionByProduct) {
      const product = productById.get(productId);
      if (!product) continue;
      const dailyRate = totalOut / FORECAST_LOOKBACK_DAYS;
      if (dailyRate <= 0) continue;
      const daysUntilEmpty = Math.round(Number(product.qty) / dailyRate);
      if (daysUntilEmpty > DIGEST_FORECAST_HORIZON_DAYS) continue;
      imminentForecast.push({
        article: product.article,
        name: product.name,
        daysUntilEmpty,
        suggestedOrderQty: Math.ceil(dailyRate * 30),
      });
    }
    imminentForecast.sort((a, b) => a.daysUntilEmpty - b.daysUntilEmpty);

    let body = 'Щоденний підсумок складу SH ERP\n\n';
    body += `Товарів нижче мінімального залишку: ${lowStock.length}\n`;
    for (const p of lowStock.slice(0, 20)) {
      body += `- ${p.article} — ${p.name}: ${p.qty} (мін. ${p.minQty})\n`;
    }

    if (imminentForecast.length) {
      body += `\nЗакінчаться протягом ${DIGEST_FORECAST_HORIZON_DAYS} днів (за темпом витрати):\n`;
      for (const f of imminentForecast) {
        body += `- ${f.article} — ${f.name}: закінчиться через ${f.daysUntilEmpty} дн., варто замовити ~${f.suggestedOrderQty}\n`;
      }
    }

    if (!lowStock.length && !imminentForecast.length) {
      body += 'Усе в нормі, критичних залишків немає.';
    }

    return {
      subject: 'SH ERP — щоденний підсумок складу',
      body,
      lowStockCount: lowStock.length,
      imminentForecastCount: imminentForecast.length,
    };
  }

  /**
   * On-demand send for the currently-authenticated company (the "send now"
   * button / admin-triggered path). No-ops with a clear reason if the
   * digest isn't enabled or no destination email is configured — mirrors
   * the legacy `dailyLowStockDigest_`'s own early return when
   * `DailyDigestEmail` is unset, just surfaced as a real response instead
   * of a silent no-op inside a time-trigger nobody's watching.
   */
  async sendDigestForCompany(user: RequestUser): Promise<{ sent: boolean; reason?: string; content?: LowStockDigestContent }> {
    const settings = await this.prisma.tenant.companySettings.findUnique({ where: { companyId: user.companyId } });
    if (!settings?.dailyDigestEnabled || !settings.dailyDigestEmail) {
      return { sent: false, reason: 'Daily digest is not enabled or no destination email is configured (see Settings).' };
    }

    const content = await this.buildDigestContent();
    const result = await this.emailService.send(settings.dailyDigestEmail, content.subject, content.body);
    this.logger.log(`Low-stock digest for company ${user.companyId}: sent=${result.sent}, lowStock=${content.lowStockCount}, imminent=${content.imminentForecastCount}`);
    return { sent: result.sent, content };
  }
}
