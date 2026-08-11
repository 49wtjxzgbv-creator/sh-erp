import { Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminAuditService } from './super-admin-audit.service';
import { RequestSuperAdmin } from './super-admin-context';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';

/** "Переглядати всіх користувачів; скидати пароль; блокувати" — cross-company, via SuperAdminPrismaService (BYPASSRLS). */
@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: SuperAdminPrismaService,
    private readonly superAdminAudit: SuperAdminAuditService,
  ) {}

  async list(query: { search?: string; limit?: number; offset?: number }) {
    const where = query.search
      ? { OR: [{ email: { contains: query.search, mode: 'insensitive' as const } }, { fullName: { contains: query.search, mode: 'insensitive' as const } }] }
      : {};
    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          email: true,
          fullName: true,
          active: true,
          createdAt: true,
          memberships: { select: { companyId: true, roleId: true, company: { select: { name: true, slug: true } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  /**
   * Never reveals or stores a recoverable password — `passwordHash` is a
   * one-way argon2id hash, same as normal registration/login. This SETS a
   * brand-new password on the user's behalf (e.g. they're locked out and
   * asked support for help), it cannot show what they already have. Every
   * existing refresh token for the user is revoked across all companies,
   * so a reset also forces re-authentication everywhere — standard
   * practice for an admin-initiated credential change.
   */
  async resetPassword(actor: RequestSuperAdmin, userId: string, dto: ResetUserPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const newPassword = dto.newPassword ?? randomBytes(9).toString('base64url'); // 12 chars, URL-safe
    const passwordHash = await argon2.hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash, legacyPasswordHash: null } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);

    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'user.password_reset',
      targetType: 'User',
      targetId: userId,
      metadata: { email: user.email, generated: !dto.newPassword },
    });

    // The only time the plaintext password exists outside the user's own
    // head — returned once, over the already-authenticated Super Admin
    // channel, exactly like a "reset link" email would carry it. Never
    // logged, never stored.
    return { userId, email: user.email, newPassword };
  }

  async setActive(actor: RequestSuperAdmin, userId: string, active: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const updated = await this.prisma.user.update({ where: { id: userId }, data: { active } });
    if (!active) {
      // Blocking a user should also end any session they're already in.
      await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }

    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: active ? 'user.unblocked' : 'user.blocked',
      targetType: 'User',
      targetId: userId,
      metadata: { email: user.email },
    });

    return updated;
  }
}
