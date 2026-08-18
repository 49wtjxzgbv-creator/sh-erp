import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateMembershipRoleDto } from './dto/update-membership.dto';
import {
  CodedBadRequestException,
  CodedConflictException,
  CodedForbiddenException,
  CodedNotFoundException,
  CodedUnauthorizedException,
} from '../../common/api-exceptions';

/**
 * Company user management (Phase 1 §3.1's `Users.gs`, deliberately not
 * ported as a company-creates-its-first-user-only flow — that was Module
 * 1's original, disclosed scope gap, see backend/README.md's "What's NOT
 * built yet" §5 before this module existed). `User` is a genuinely global
 * model (not tenant-scoped — schema.prisma's own comment, confirmed by the
 * Phase 3 review: "users (global, no RLS)"), so every read/write here goes
 * through `PrismaService.tenant.user`, which — correctly, per that same
 * design — does NOT get an implicit companyId filter injected (see
 * `tenant-scoped-models.ts`: `User` is intentionally absent from the list).
 * Every method below is therefore careful to scope by the *membership*
 * (`CompanyMembership`, which IS tenant-scoped) wherever a company boundary
 * actually needs enforcing, never by assuming a `User` query is
 * automatically scoped for you.
 *
 * Invite design, disclosed rather than silently improvised: the schema has
 * no `Invitation`/pending-membership model — a `User` row is either fully
 * created with a password, or does not exist. So `invite()` mirrors the
 * legacy `Users.gs#createUser` exactly for a brand-new email (the account
 * is created immediately, not "pending until accepted"), just modernized:
 * a random temporary password is generated and emailed via `EmailService`
 * (which — as documented in its own header comment — fails open to a log
 * line if SMTP isn't configured, matching the digest module's precedent).
 * Because `EmailService.send` can silently not-deliver, the plaintext temp
 * password is also returned once in the API response so the inviting admin
 * can relay it manually if email delivery isn't set up yet — a deliberate,
 * disclosed tradeoff for a launch-stage system, not an oversight. If the
 * invited email already belongs to a `User` elsewhere (multi-company
 * membership, which this schema fully supports — see `User`'s own header
 * comment), no password is touched at all; only a new `CompanyMembership`
 * is created, and the notification email says "added to a company", not
 * "here is your password".
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
  ) {}

  async list(user: RequestUser) {
    const memberships = await this.prisma.tenant.companyMembership.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: 'asc' },
    });
    const userIds = memberships.map((m) => m.userId);
    const roleIds = [...new Set(memberships.map((m) => m.roleId))];

    const [users, roles] = await Promise.all([
      this.prisma.tenant.user.findMany({ where: { id: { in: userIds } } }),
      this.prisma.tenant.role.findMany({ where: { id: { in: roleIds } } }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const roleById = new Map(roles.map((r) => [r.id, r]));

    return memberships.map((m) => {
      const u = userById.get(m.userId);
      const r = roleById.get(m.roleId);
      return {
        userId: m.userId,
        email: u?.email ?? null,
        fullName: u?.fullName ?? null,
        active: u?.active ?? false,
        roleId: m.roleId,
        roleName: r?.name ?? null,
        memberSince: m.createdAt,
      };
    });
  }

  async invite(user: RequestUser, dto: InviteUserDto) {
    const role = await this.prisma.tenant.role.findUnique({ where: { id: dto.roleId } });
    if (!role) throw new CodedBadRequestException('ROLE_UNKNOWN', 'Unknown role.');

    let target = await this.prisma.tenant.user.findUnique({ where: { email: dto.email } });
    let tempPassword: string | null = null;

    if (target) {
      const existingMembership = await this.prisma.tenant.companyMembership.findUnique({
        where: { companyId_userId: { companyId: user.companyId, userId: target.id } },
      });
      if (existingMembership) {
        throw new CodedConflictException('MEMBERSHIP_ALREADY_EXISTS', 'This person already has access to this company.');
      }
    } else {
      tempPassword = this.generateTempPassword();
      const passwordHash = await argon2.hash(tempPassword);
      target = await this.prisma.tenant.user.create({
        data: { email: dto.email, fullName: dto.fullName, passwordHash },
      });
    }

    const membership = await this.prisma.tenant.companyMembership.create({
      data: { companyId: user.companyId, userId: target.id, roleId: dto.roleId },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'user.invited',
      entityType: 'CompanyMembership',
      entityId: membership.id,
      after: { userId: target.id, email: target.email, roleId: dto.roleId },
    });

    if (tempPassword) {
      await this.emailService.send(
        target.email,
        'Запрошення до SH ERP',
        `Вас додано до системи SH ERP.\nЕл. пошта: ${target.email}\nТимчасовий пароль: ${tempPassword}\nБудь ласка, увійдіть і змініть пароль у своєму профілі.`,
      );
    } else {
      await this.emailService.send(
        target.email,
        'Доступ до нової компанії в SH ERP',
        `Вас додано до нової компанії в системі SH ERP. Увійдіть під своїм наявним обліковим записом (${target.email}) і оберіть цю компанію.`,
      );
    }

    return { userId: target.id, email: target.email, fullName: target.fullName, roleId: dto.roleId, tempPassword };
  }

  async updateRole(user: RequestUser, targetUserId: string, dto: UpdateMembershipRoleDto) {
    const membership = await this.getMembershipOrThrow(user.companyId, targetUserId);
    const role = await this.prisma.tenant.role.findUnique({ where: { id: dto.roleId } });
    if (!role) throw new CodedBadRequestException('ROLE_UNKNOWN', 'Unknown role.');

    const updated = await this.prisma.tenant.companyMembership.update({
      where: { id: membership.id },
      data: { roleId: dto.roleId },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'user.role_changed',
      entityType: 'CompanyMembership',
      entityId: membership.id,
      before: { roleId: membership.roleId },
      after: { roleId: dto.roleId },
    });

    return updated;
  }

  /**
   * Revokes this company's access for a user — removes the CompanyMembership
   * row, it does not touch the global `User` row (which may belong to other
   * companies, or simply must keep existing for audit-trail foreign keys
   * elsewhere). Two safety guards, the first a direct port of Phase 1 §3.1's
   * "blocks self-deletion", the second new hardening this schema needs that
   * the legacy single-tenant system never had to consider: a company must
   * never end up with zero members (there would be no one left who could
   * ever invite anyone back in).
   */
  async deactivate(user: RequestUser, targetUserId: string) {
    if (targetUserId === user.userId) {
      throw new CodedForbiddenException('MEMBERSHIP_CANNOT_REMOVE_SELF', 'You cannot remove your own access. Ask another admin to do this.');
    }
    const membership = await this.getMembershipOrThrow(user.companyId, targetUserId);

    const memberCount = await this.prisma.tenant.companyMembership.count({ where: { companyId: user.companyId } });
    if (memberCount <= 1) {
      throw new CodedBadRequestException('COMPANY_LAST_MEMBER', 'Cannot remove the last remaining member of a company.');
    }

    await this.prisma.tenant.companyMembership.delete({ where: { id: membership.id } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'user.deactivated',
      entityType: 'CompanyMembership',
      entityId: membership.id,
      before: membership,
    });

    return { userId: targetUserId, removed: true };
  }

  async changeOwnPassword(user: RequestUser, dto: ChangePasswordDto) {
    const dbUser = await this.prisma.tenant.user.findUnique({ where: { id: user.userId } });
    if (!dbUser || !dbUser.passwordHash) {
      throw new CodedUnauthorizedException('AUTH_PASSWORD_UNVERIFIABLE', 'Cannot verify current password.');
    }
    const ok = await argon2.verify(dbUser.passwordHash, dto.currentPassword);
    if (!ok) throw new CodedUnauthorizedException('AUTH_CURRENT_PASSWORD_INCORRECT', 'Current password is incorrect.');

    const newHash = await argon2.hash(dto.newPassword);
    await this.prisma.tenant.user.update({ where: { id: user.userId }, data: { passwordHash: newHash } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'user.password_changed',
      entityType: 'User',
      entityId: user.userId,
    });

    return { changed: true };
  }

  private async getMembershipOrThrow(companyId: string, userId: string) {
    const membership = await this.prisma.tenant.companyMembership.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!membership) throw new CodedNotFoundException('MEMBERSHIP_NOT_FOUND', 'This user is not a member of this company.');
    return membership;
  }

  private generateTempPassword(): string {
    // 18 base64url chars ≈ 13.5 bytes of entropy — short enough to relay
    // over the phone if email delivery isn't configured yet, long enough
    // to comfortably clear every password's 12-char minimum.
    return randomBytes(14).toString('base64url');
  }
}
