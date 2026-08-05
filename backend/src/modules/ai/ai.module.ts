import { Module } from '@nestjs/common';
import { BomModule } from '../bom/bom.module';
import { FilesModule } from '../files/files.module';
import { HrModule } from '../hr/hr.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReportsModule } from '../reports/reports.module';
import { SalesModule } from '../sales/sales.module';
import { AiActionsService } from './ai-actions.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiSettingsService } from './ai-settings.service';
import { AI_PROVIDER_PORT } from './providers/ai-provider.port';
import { GeminiAdapter } from './providers/gemini.adapter';
import { AI_TOOLS } from './tools/ai-tool.interface';
import { AdjustProductStockTool } from './tools/adjust-stock.tool';
import { GetAssemblyDetailTool, GetLowStockProductsTool, SearchAssembliesTool, SearchProductsTool } from './tools/catalog.tools';
import { ExportToExcelTool, ExportToPdfTool } from './tools/export.tools';
import { ListPurchaseOrdersTool, ListSuppliersTool } from './tools/procurement.tools';
import { FindProductionDelaysTool, ForecastPurchaseNeedsTool, ListProductionOrdersTool } from './tools/production.tools';
import { GetPayrollSummaryTool, GetWarehouseSummaryTool } from './tools/reports.tools';
import { GetCustomerOrderDetailTool, ListCustomerOrdersTool } from './tools/sales.tools';
import { AiToolsRegistry } from './tools/tools.registry';

const TOOL_PROVIDERS = [
  SearchProductsTool,
  GetLowStockProductsTool,
  SearchAssembliesTool,
  GetAssemblyDetailTool,
  ListCustomerOrdersTool,
  GetCustomerOrderDetailTool,
  ListProductionOrdersTool,
  FindProductionDelaysTool,
  ForecastPurchaseNeedsTool,
  ListPurchaseOrdersTool,
  ListSuppliersTool,
  GetWarehouseSummaryTool,
  GetPayrollSummaryTool,
  ExportToExcelTool,
  ExportToPdfTool,
  AdjustProductStockTool,
];

/**
 * AI module (Phase 1 §3.7 / Phase 2 §8, roadmap Module 11). Provider-abstracted
 * (`AiProviderPort` / `GeminiAdapter`, the only implementation so far),
 * function-calling tool registry (16 tools, ported from `AI_TOOLS_` in
 * `AI_FullAssistant.gs`), and the durable `PendingAiAction` critical-action
 * confirmation flow that replaces the legacy in-memory `needs_confirmation`
 * pattern. Imports every domain module whose service a tool reuses rather
 * than re-implementing that logic — see each tool file's header comment for
 * which one and why.
 */
@Module({
  imports: [BomModule, SalesModule, InventoryModule, HrModule, ReportsModule, FilesModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiActionsService,
    AiSettingsService,
    AiToolsRegistry,
    { provide: AI_PROVIDER_PORT, useClass: GeminiAdapter },
    ...TOOL_PROVIDERS,
    {
      provide: AI_TOOLS,
      useFactory: (...tools: any[]) => tools,
      inject: TOOL_PROVIDERS,
    },
  ],
  exports: [AiService, AiActionsService, AiSettingsService],
})
export class AiModule {}
