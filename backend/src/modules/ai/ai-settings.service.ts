import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateCompanyAiSettingsDto } from './dto/company-ai-settings.dto';
import { decryptApiKey, encryptApiKey } from './ai-crypto.util';

/**
 * `CompanyAiSettings` (Phase 2 §8) — per-company AI configuration: an
 * optional bring-your-own API key (else the platform-provided key is used,
 * metered against the company's plan) and an optional monthly usage quota.
 * Mirrors the legacy `saveGeminiApiKey`/`getGeminiStatus` (Gemini.gs),
 * upgraded from a singleton Script Property to a per-tenant, encrypted-at-rest
 * row (ADR-numbered decision not required — this is additive, not a change
 * to the frozen Phase 3 schema; `CompanyAiSettings` was already modeled
 * there).
 */
@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Never returns the plaintext or ciphertext key — only whether one is configured, mirroring the legacy `getGeminiStatus`'s `{configured: boolean}` shape. */
  async getSettings(user: RequestUser) {
    const settings = await this.prisma.tenant.companyAiSettings.findUnique({ where: { companyId: user.companyId } });
    return {
      companyId: user.companyId,
      hasCustomApiKey: !!settings?.apiKeyEncrypted,
      monthlyUsageQuota: settings?.monthlyUsageQuota ?? null,
    };
  }

  async updateSettings(user: RequestUser, dto: UpdateCompanyAiSettingsDto) {
    const data: Record<string, any> = {};
    if (dto.apiKey !== undefined) {
      data.apiKeyEncrypted = dto.apiKey.trim() === '' ? null : encryptApiKey(dto.apiKey.trim());
    }
    if (dto.monthlyUsageQuota !== undefined) {
      data.monthlyUsageQuota = dto.monthlyUsageQuota;
    }

    await this.prisma.tenant.companyAiSettings.upsert({
      where: { companyId: user.companyId },
      update: data,
      create: { companyId: user.companyId, ...data },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'ai_settings.updated',
      entityType: 'CompanyAiSettings',
      entityId: user.companyId,
      metadata: { apiKeyChanged: dto.apiKey !== undefined, monthlyUsageQuotaChanged: dto.monthlyUsageQuota !== undefined },
    });

    return this.getSettings(user);
  }

  /**
   * Resolves the actual key to call the provider with — a company's own
   * key if they've set one, else the platform-provided key
   * (`AI_PLATFORM_API_KEY`). Never logged, never returned to the client.
   */
  async getEffectiveApiKey(companyId: string): Promise<string> {
    const settings = await this.prisma.tenant.companyAiSettings.findUnique({ where: { companyId } });
    if (settings?.apiKeyEncrypted) {
      return decryptApiKey(settings.apiKeyEncrypted);
    }
    return process.env.AI_PLATFORM_API_KEY || '';
  }

  async getMonthlyQuota(companyId: string): Promise<number | null> {
    const settings = await this.prisma.tenant.companyAiSettings.findUnique({ where: { companyId } });
    return settings?.monthlyUsageQuota ?? null;
  }
}
