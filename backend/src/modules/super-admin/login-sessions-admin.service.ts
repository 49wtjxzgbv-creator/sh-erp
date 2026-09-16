import { Injectable } from '@nestjs/common';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { GeoIpService } from './geo-ip.service';
import { parseUserAgent } from './parse-user-agent';

/**
 * "Хто заходить в програму з якого акаунта, IP, пристрою та геолокації, і
 * історія заходів" (Super Admin, 2026-09-16 user request).
 *
 * Built entirely on `RefreshToken` (`ipAddress`/`device` columns existed
 * since ADR-0006 but were never actually populated anywhere until this same
 * change — see AuthController#login/refresh) rather than a new table: a
 * fresh row is created on every login AND on every silent access-token
 * refresh (same `familyId`, ~every 15 min while a user stays active) — a
 * raw listing would be almost entirely rotation noise, not "who logged in
 * and when". A row counts as a real "login event" here only when it starts
 * a brand-new family (`login()`/`issueImpersonationSession()`) OR resumes
 * an existing one after a gap longer than `SESSION_GAP_MS` (2026-09-16
 * user's own definition: "коли користувач робив якісь дії... після паузи в
 * годину" — came back after being away, not a routine heartbeat rotation).
 *
 * `WINDOW_SIZE` bounds this to a recent-history window (most recent N raw
 * rows across every company) rather than scanning the whole table — no
 * pruning/archival job exists for `RefreshToken` yet, so an unbounded scan
 * would only get slower over the app's lifetime. `total` below is the login
 * count WITHIN that window, not an all-time total — an honest label for a
 * "recent activity" view, not a claim to be a complete historical archive.
 */
const WINDOW_SIZE = 2000;
const SESSION_GAP_MS = 60 * 60 * 1000;

export interface LoginSessionRow {
  id: string;
  createdAt: Date;
  userId: string;
  userEmail: string;
  userFullName: string;
  companyId: string;
  companyName: string;
  ipAddress: string | null;
  device: string;
  city: string | null;
  country: string | null;
  /** Set only when this session was minted by a Super Admin's "Увійти як" — ip/device above are then the ADMIN's own, not the impersonated user's (see AuthService#issueImpersonationSession). */
  impersonatedBySuperAdminId: string | null;
}

@Injectable()
export class LoginSessionsAdminService {
  constructor(
    private readonly prisma: SuperAdminPrismaService,
    private readonly geoIp: GeoIpService,
  ) {}

  async list(limit = 50, offset = 0): Promise<{ items: LoginSessionRow[]; total: number; limit: number; offset: number }> {
    const rows = await this.prisma.refreshToken.findMany({
      orderBy: { createdAt: 'desc' },
      take: WINDOW_SIZE,
      select: {
        id: true,
        createdAt: true,
        userId: true,
        companyId: true,
        familyId: true,
        ipAddress: true,
        device: true,
        impersonatedBy: true,
        user: { select: { email: true, fullName: true } },
      },
    });

    const byFamily = new Map<string, typeof rows>();
    for (const row of rows) {
      const arr = byFamily.get(row.familyId) ?? [];
      arr.push(row);
      byFamily.set(row.familyId, arr);
    }

    const loginEventIds = new Set<string>();
    for (const familyRows of byFamily.values()) {
      const sorted = [...familyRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      let prevCreatedAt: number | null = null;
      for (const row of sorted) {
        if (prevCreatedAt === null || row.createdAt.getTime() - prevCreatedAt > SESSION_GAP_MS) {
          loginEventIds.add(row.id);
        }
        prevCreatedAt = row.createdAt.getTime();
      }
    }

    const loginEvents = rows.filter((r) => loginEventIds.has(r.id)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = loginEvents.length;
    const page = loginEvents.slice(offset, offset + limit);

    const companyIds = Array.from(new Set(page.map((r) => r.companyId)));
    const companies = companyIds.length
      ? await this.prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
      : [];
    const companyNameById = new Map(companies.map((c) => [c.id, c.name]));

    const geo = await this.geoIp.lookupMany(page.map((r) => r.ipAddress).filter((ip): ip is string => Boolean(ip)));

    const items: LoginSessionRow[] = page.map((r) => {
      const g = r.ipAddress ? geo.get(r.ipAddress) : undefined;
      return {
        id: r.id,
        createdAt: r.createdAt,
        userId: r.userId,
        userEmail: r.user.email,
        userFullName: r.user.fullName,
        companyId: r.companyId,
        companyName: companyNameById.get(r.companyId) ?? r.companyId,
        ipAddress: r.ipAddress,
        device: parseUserAgent(r.device),
        city: g?.city ?? null,
        country: g?.country ?? null,
        impersonatedBySuperAdminId: r.impersonatedBy,
      };
    });

    return { items, total, limit, offset };
  }
}
