import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminLoginDto } from './dto/super-admin-login.dto';
import { SuperAdminAuditService } from './super-admin-audit.service';
import { CodedUnauthorizedException } from '../../common/api-exceptions';

/**
 * Genuinely separate login flow from `AuthService` (Company Admin / regular
 * users) — different table (`SuperAdmin`, not `User`), different token
 * secret (`SUPER_ADMIN_JWT_SECRET`, not `JWT_ACCESS_SECRET`), no company
 * context at all (no `companySlug`, no `CompanyMembership` lookup). No
 * refresh token either, deliberately: a super-admin session is short
 * (`SUPER_ADMIN_JWT_TTL`, default 30m — longer than a regular 15m access
 * token since this panel is used for real admin work, not a quick API
 * call), and re-authenticating is a single login form submit, not a
 * meaningful burden. Keeping this stateless (no RefreshToken-equivalent
 * table) also means there is nothing here for the reuse-detection /
 * rotation-family machinery in ADR-0006 to need to replicate.
 */
@Injectable()
export class SuperAdminAuthService {
  constructor(
    private readonly prisma: SuperAdminPrismaService,
    private readonly jwt: JwtService,
    private readonly superAdminAudit: SuperAdminAuditService,
  ) {}

  async login(dto: SuperAdminLoginDto): Promise<{ accessToken: string; expiresIn: string }> {
    const admin = await this.prisma.superAdmin.findUnique({ where: { email: dto.email } });
    if (!admin || !admin.active) {
      throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const ok = await argon2.verify(admin.passwordHash, dto.password);
    if (!ok) {
      throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const secret = process.env.SUPER_ADMIN_JWT_SECRET;
    if (!secret) {
      throw new CodedUnauthorizedException(
        'SUPER_ADMIN_AUTH_DISABLED',
        'SUPER_ADMIN_JWT_SECRET is not configured on this server — Super Admin auth is disabled until it is set.',
      );
    }
    const expiresIn = process.env.SUPER_ADMIN_JWT_TTL ?? '30m';

    const accessToken = this.jwt.sign(
      { sub: admin.id, email: admin.email, type: 'super_admin' },
      { secret, expiresIn },
    );

    await this.prisma.superAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await this.superAdminAudit.record({
      superAdminId: admin.id,
      action: 'super_admin.login',
    });

    return { accessToken, expiresIn };
  }
}
