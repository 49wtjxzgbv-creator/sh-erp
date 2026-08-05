import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthPrismaService } from '../../prisma/auth-prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: process.env.JWT_ACCESS_TTL ?? '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthPrismaService],
  exports: [AuthService, JwtModule],
})
export class IdentityModule {}
