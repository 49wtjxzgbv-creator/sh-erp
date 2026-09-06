import { Injectable } from '@nestjs/common';
import { CodedBadRequestException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateCompanyAiSettingsDto } from './dto/company-ai-settings.dto';
import { decryptApiKey, encryptApiKey } from './ai-crypto.util';

export type AiProviderName = 'gemini' | 'deepseek';

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
      provider: (settings?.provider as AiProviderName) ?? 'gemini',
      hasCustomApiKey: !!settings?.apiKeyEncrypted,
      monthlyUsageQuota: settings?.monthlyUsageQuota ?? null,
      contextText: settings?.contextText ?? '',
    };
  }

  async updateSettings(user: RequestUser, dto: UpdateCompanyAiSettingsDto) {
    const data: Record<string, any> = {};
    if (dto.provider !== undefined) {
      data.provider = dto.provider;
    }
    if (dto.apiKey !== undefined) {
      data.apiKeyEncrypted = dto.apiKey.trim() === '' ? null : encryptApiKey(dto.apiKey.trim());
    }
    if (dto.monthlyUsageQuota !== undefined) {
      data.monthlyUsageQuota = dto.monthlyUsageQuota;
    }
    if (dto.contextText !== undefined) {
      data.contextText = dto.contextText.trim() === '' ? null : dto.contextText.trim();
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
      metadata: {
        providerChanged: dto.provider !== undefined,
        apiKeyChanged: dto.apiKey !== undefined,
        monthlyUsageQuotaChanged: dto.monthlyUsageQuota !== undefined,
        contextTextChanged: dto.contextText !== undefined,
      },
    });

    return this.getSettings(user);
  }

  /** The company's "who we are / what we make" blurb (2026-09-06), if they've set one — see CompanyAiSettings.contextText's own schema comment for where this gets used. Empty string when unset, never null, so every call site can just prepend it without a null-check. */
  async getContextText(companyId: string): Promise<string> {
    const settings = await this.prisma.tenant.companyAiSettings.findUnique({ where: { companyId } });
    return settings?.contextText ?? '';
  }

  /** Which vendor to call for this company — see CompanyAiSettings.provider's own schema comment. */
  async getProvider(companyId: string): Promise<AiProviderName> {
    const settings = await this.prisma.tenant.companyAiSettings.findUnique({ where: { companyId } });
    return (settings?.provider as AiProviderName) ?? 'gemini';
  }

  /**
   * Resolves the actual key to call the provider with. Gemini: a
   * company's own key if they've set one, else the platform-provided key
   * (`AI_PLATFORM_API_KEY`). DeepSeek: company key ONLY — there is no
   * platform-provided DeepSeek key (AI_PLATFORM_API_KEY is a Gemini key;
   * sending it to DeepSeek's endpoint would just fail auth), so a company
   * that switches to DeepSeek without ever entering its own key gets a
   * clear, actionable error instead of a confusing provider-side 401.
   * Never logged, never returned to the client.
   */
  async getEffectiveApiKey(companyId: string): Promise<string> {
    const settings = await this.prisma.tenant.companyAiSettings.findUnique({ where: { companyId } });
    const provider: AiProviderName = (settings?.provider as AiProviderName) ?? 'gemini';

    if (settings?.apiKeyEncrypted) {
      return decryptApiKey(settings.apiKeyEncrypted);
    }
    if (provider === 'deepseek') {
      throw new CodedBadRequestException('AI_DEEPSEEK_KEY_REQUIRED', 'DeepSeek requires your own API key — add it in Налаштування → AI.');
    }
    return process.env.AI_PLATFORM_API_KEY || '';
  }

  /**
   * Gemini specifically, regardless of the company's chosen `provider` —
   * for the two capabilities (`askFullAssistant`'s function-calling,
   * `recognizeInvoice`'s image vision) that only GeminiAdapter implements.
   * If the company switched to DeepSeek, their stored `apiKeyEncrypted` is
   * a DeepSeek key (wrong vendor for these two calls), so this falls back
   * to the platform-provided Gemini key instead of using it — graceful
   * degradation to the metered platform key rather than a confusing
   * provider-mismatch error on features the company never touched the
   * setting for.
   */
  async getGeminiApiKey(companyId: string): Promise<string> {
    const settings = await this.prisma.tenant.companyAiSettings.findUnique({ where: { companyId } });
    const provider: AiProviderName = (settings?.provider as AiProviderName) ?? 'gemini';
    if (provider === 'gemini' && settings?.apiKeyEncrypted) {
      return decryptApiKey(settings.apiKeyEncrypted);
    }
    return process.env.AI_PLATFORM_API_KEY || '';
  }

  async getMonthlyQuota(companyId: string): Promise<number | null> {
    const settings = await this.prisma.tenant.companyAiSettings.findUnique({ where: { companyId } });
    return settings?.monthlyUsageQuota ?? null;
  }
}
