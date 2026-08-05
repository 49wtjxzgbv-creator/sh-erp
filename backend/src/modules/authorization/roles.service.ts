import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/upsert-role.dto';
import { DEFAULT_ROLES, PERMISSIONS_CATALOGUE } from './permissions.catalogue';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Creates the 5 default (`isSystem = true`) roles for a newly-created
   * company, wired to the fixed permission catalogue — mirrors
   * prisma/seed.ts's per-company seeding plan (Phase 3 §7). Called once,
   * from CompanyService.createCompany (see ../tenancy/company.service.ts),
   * inside that same signup transaction.
   *
   * Takes `tx` explicitly (not `this.prisma.tenant`) — this used to run on
   * the raw, non-transactional client, which was a real bug once RLS is
   * actually enforced: `roles`/`role_permissions` are FORCE-RLS tenant-scoped
   * tables (tenant-scoped-models.ts), so an INSERT with no
   * `SET LOCAL app.current_company_id` active would be rejected by Postgres
   * outright. Fixed alongside the `auth_service` role work (same class of
   * "write happens before/without an active tenant transaction" gap) — see
   * CompanyService.createCompany, which now opens that transaction via
   * `PrismaService.runInTenantTransaction` and threads `tx` through to every
   * per-company seeder, this one included.
   */
  async seedDefaultRoles(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
    const allPermissions = await tx.permission.findMany();
    const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

    for (const roleDef of DEFAULT_ROLES) {
      const role = await tx.role.create({
        data: {
          companyId,
          name: roleDef.name,
          isSystem: true,
        },
      });

      const grants = roleDef.permissions
        .map((key) => permissionIdByKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId }));

      if (grants.length > 0) {
        await tx.rolePermission.createMany({ data: grants });
      }
    }
  }

  /**
   * Production-readiness-review addition: the schema/permission model for
   * per-company custom roles (Phase 2's headline "flexible RBAC" capability,
   * vs. the legacy system's 3 hardcoded roles) has existed since Phase 3,
   * but until this pass nothing exposed it — `seedDefaultRoles` above only
   * ever *created* roles, nothing let a company *see or edit* them. The
   * methods below are that missing surface.
   */
  async list(user: RequestUser) {
    const roles = await this.prisma.tenant.role.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: true } } },
    });
    return roles.map((r) => this.toRoleDto(r));
  }

  async create(user: RequestUser, dto: CreateRoleDto) {
    const permissionIds = await this.resolvePermissionIds(dto.permissionKeys);

    const existing = await this.prisma.tenant.role.findUnique({
      where: { companyId_name: { companyId: user.companyId, name: dto.name } },
    });
    if (existing) throw new ConflictException('A role with this name already exists.');

    const role = await this.prisma.tenant.role.create({
      data: {
        companyId: user.companyId,
        name: dto.name,
        description: dto.description,
        isSystem: false,
        permissions: { createMany: { data: permissionIds.map((permissionId) => ({ permissionId })) } },
      },
      include: { permissions: { include: { permission: true } } },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'role.created',
      entityType: 'Role',
      entityId: role.id,
      after: { name: role.name, permissionKeys: dto.permissionKeys },
    });

    return this.toRoleDto(role);
  }

  /**
   * `isSystem` roles CAN have their name/description/permissions edited
   * (schema.prisma's own field comment on `Role.isSystem`: "cannot be
   * deleted, can still have permissions edited") — only `remove()` below
   * distinguishes system roles, not this method.
   */
  async update(user: RequestUser, roleId: string, dto: UpdateRoleDto) {
    const role = await this.getRoleOrThrow(user.companyId, roleId);

    if (dto.name && dto.name !== role.name) {
      const existing = await this.prisma.tenant.role.findUnique({
        where: { companyId_name: { companyId: user.companyId, name: dto.name } },
      });
      if (existing) throw new ConflictException('A role with this name already exists.');
    }

    const data: Prisma.RoleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;

    if (dto.permissionKeys !== undefined) {
      const permissionIds = await this.resolvePermissionIds(dto.permissionKeys);
      await this.prisma.tenant.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length > 0) {
        await this.prisma.tenant.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        });
      }
    }

    const updated = await this.prisma.tenant.role.update({
      where: { id: roleId },
      data,
      include: { permissions: { include: { permission: true } } },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'role.updated',
      entityType: 'Role',
      entityId: roleId,
      before: { name: role.name },
      after: { name: updated.name, permissionKeys: dto.permissionKeys },
    });

    return this.toRoleDto(updated);
  }

  /** Blocked for `isSystem` roles and for any role still assigned to at least one CompanyMembership — both real referential-safety guards, not arbitrary restrictions. */
  async remove(user: RequestUser, roleId: string) {
    const role = await this.getRoleOrThrow(user.companyId, roleId);
    if (role.isSystem) {
      throw new BadRequestException('The default system roles cannot be deleted, only edited.');
    }

    const inUse = await this.prisma.tenant.companyMembership.count({ where: { roleId } });
    if (inUse > 0) {
      throw new BadRequestException('This role is still assigned to at least one member — reassign them first.');
    }

    await this.prisma.tenant.role.delete({ where: { id: roleId } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'role.deleted',
      entityType: 'Role',
      entityId: roleId,
      before: { name: role.name },
    });

    return { id: roleId, deleted: true };
  }

  /** Static, not company-editable (see this file's own header note re: PERMISSIONS_CATALOGUE) — read from the seeded `Permission` table so the UI's picker always matches what a grant can actually reference. */
  async permissionsCatalogue() {
    const permissions = await this.prisma.permission.findMany({ orderBy: [{ resource: 'asc' }, { action: 'asc' }] });
    return permissions.length > 0 ? permissions : PERMISSIONS_CATALOGUE;
  }

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    if (permissions.length !== keys.length) {
      const found = new Set(permissions.map((p) => p.key));
      const missing = keys.filter((k) => !found.has(k));
      throw new BadRequestException(`Unknown permission key(s): ${missing.join(', ')}`);
    }
    return permissions.map((p) => p.id);
  }

  private async getRoleOrThrow(companyId: string, roleId: string) {
    const role = await this.prisma.tenant.role.findUnique({ where: { id: roleId } });
    if (!role || role.companyId !== companyId) throw new NotFoundException('Role not found.');
    return role;
  }

  private toRoleDto(role: {
    id: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    permissions: { permission: { key: string } }[];
  }) {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissionKeys: role.permissions.map((p) => p.permission.key),
    };
  }
}
