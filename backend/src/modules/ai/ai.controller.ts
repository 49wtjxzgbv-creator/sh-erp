import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AiActionsService } from './ai-actions.service';
import { AiService } from './ai.service';
import { AiSettingsService } from './ai-settings.service';
import { AskAboutCustomerOrderDto } from './dto/ask-about-customer-order.dto';
import { AskFullAssistantDto } from './dto/ask-full-assistant.dto';
import { AskHelpDto } from './dto/ask-help.dto';
import { CancelAiActionDto, ConfirmAiActionDto } from './dto/confirm-ai-action.dto';
import { UpdateCompanyAiSettingsDto } from './dto/company-ai-settings.dto';
import { RecognizeInvoiceDto } from './dto/recognize-invoice.dto';

/**
 * AI module (Phase 1 §3.7 / Phase 2 §8). All routes require ordinary
 * authentication; `ai:use` is granted to every default role (Admin,
 * Storekeeper, Production, Sales, Viewer) matching the legacy RBAC matrix's
 * "AI: simple Довідник / per-order Q&A" and "AI: full assistant" rows,
 * which are available to all three original roles. Individual tools (e.g.
 * payroll summary) additionally self-restrict inside `AiToolContext`.
 */
@ApiTags('ai')
@Controller({ path: 'ai', version: '1' })
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiActionsService: AiActionsService,
    private readonly aiSettingsService: AiSettingsService,
  ) {}

  @Post('ask-help')
  @RequirePermissions('ai:use')
  @ApiOperation({ summary: 'Instruction-only "Довідник" assistant — zero live-data access, cannot hallucinate real numbers (Phase 1 §3.7).' })
  async askHelp(@CurrentUser() user: RequestUser, @Body() dto: AskHelpDto) {
    return this.aiService.askHelp(user, dto.question);
  }

  @Post('ask-about-customer-order')
  @RequirePermissions('ai:use')
  @ApiOperation({ summary: 'Narrowly-scoped Q&A over one specific customer order\'s real data.' })
  async askAboutCustomerOrder(@CurrentUser() user: RequestUser, @Body() dto: AskAboutCustomerOrderDto) {
    return this.aiService.askAboutCustomerOrder(user, dto.customerOrderId, dto.question);
  }

  @Post('ask-full-assistant')
  @RequirePermissions('ai:use')
  @ApiOperation({ summary: 'Full function-calling assistant over the tool registry. Critical actions (e.g. stock adjustment) never execute inline — the response carries a pendingConfirmation instead.' })
  async askFullAssistant(@CurrentUser() user: RequestUser, @Body() dto: AskFullAssistantDto) {
    return this.aiService.askFullAssistant(user, dto);
  }

  @Post('confirm-action')
  @RequirePermissions('ai:use-critical-actions')
  @ApiOperation({ summary: 'Executes a previously-proposed critical action (e.g. adjustProductStock) after explicit user confirmation.' })
  async confirmAction(@CurrentUser() user: RequestUser, @Body() dto: ConfirmAiActionDto) {
    return this.aiService.confirmAction(user, dto.pendingActionId);
  }

  @Post('cancel-action')
  @RequirePermissions('ai:use')
  @ApiOperation({ summary: 'Cancels a previously-proposed critical action without executing it.' })
  async cancelAction(@CurrentUser() user: RequestUser, @Body() dto: CancelAiActionDto) {
    return this.aiActionsService.cancelAction(user, dto.pendingActionId);
  }

  @Post('recognize-invoice')
  @RequirePermissions('ai:use')
  @ApiOperation({ summary: 'Supplier invoice photo/scan → structured line items, fuzzy-matched against existing Products.' })
  async recognizeInvoice(@CurrentUser() user: RequestUser, @Body() dto: RecognizeInvoiceDto) {
    return this.aiService.recognizeInvoice(user, dto.base64Image, dto.mimeType);
  }

  @Get('settings')
  @RequirePermissions('ai:settings-manage')
  @ApiOperation({ summary: 'Whether a company-specific API key is configured and the monthly usage quota — never returns the key itself.' })
  async getSettings(@CurrentUser() user: RequestUser) {
    return this.aiSettingsService.getSettings(user);
  }

  @Put('settings')
  @RequirePermissions('ai:settings-manage')
  @ApiOperation({ summary: 'Set/clear a bring-your-own API key and/or the monthly usage quota.' })
  async updateSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateCompanyAiSettingsDto) {
    return this.aiSettingsService.updateSettings(user, dto);
  }
}
