import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

// Global: nearly every other module needs AuditService to log its own
// mutations (Phase 2 §2.1 cross-cutting concern), so it's exported globally
// rather than re-imported module by module.
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
