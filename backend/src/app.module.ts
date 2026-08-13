import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { IdentityModule } from './modules/identity/identity.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { AuditModule } from './modules/audit/audit.module';
import { FilesModule } from './modules/files/files.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { SettingsModule } from './modules/settings/settings.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { BomModule } from './modules/bom/bom.module';
import { ProductionModule } from './modules/production/production.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { SalesModule } from './modules/sales/sales.module';
import { HrModule } from './modules/hr/hr.module';
import { ReportsModule } from './modules/reports/reports.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PlannerModule } from './modules/planner/planner.module';
import { SearchModule } from './modules/search/search.module';
import { AiModule } from './modules/ai/ai.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BillingModule } from './modules/billing/billing.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { SupplierPortalModule } from './modules/supplier-portal/supplier-portal.module';
import { LegacyImportModule } from './modules/legacy-import/legacy-import.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        redact: ['req.headers.authorization'], // never log bearer tokens
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), // per-IP baseline; tightened per-route later (e.g. login) as Phase 5 continues
    PrismaModule,
    AuditModule,
    IdentityModule,
    AuthorizationModule,
    TenancyModule,
    FilesModule,
    CatalogModule,
    SettingsModule,
    InventoryModule,
    BomModule,
    ProductionModule,
    ProcurementModule,
    SalesModule,
    HrModule,
    ReportsModule,
    DashboardModule,
    PlannerModule,
    SearchModule,
    AiModule,
    LegacyImportModule,
    NotificationsModule,
    BillingModule,
    UsersModule,
    HealthModule,
    SuperAdminModule,
    SupplierPortalModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
