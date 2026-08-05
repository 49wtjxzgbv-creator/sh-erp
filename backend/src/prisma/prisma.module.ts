import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global: every module needs data access, and Prisma connections are
// expensive enough that a single shared instance (not one per feature
// module) is the right default — matches standard NestJS/Prisma guidance.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
