/**
 * Fixed permission catalogue (Phase 2 §6): permission keys correspond to
 * real enforcement points in code, and this list only grows when a new
 * enforcement point ships — it is NOT company-editable (only which
 * permissions a given company's roles carry is editable; see the `Role`
 * and `RolePermission` models). Seeded into the `permissions` table by
 * prisma/seed.ts (Phase 3 §7); this file is the source of truth that seed
 * script reads from, so the two never drift.
 *
 * Grouped by module per the Phase 2 §2.1 NestJS module map. Only the
 * Module 1 (Tenancy/Identity/Authorization) and a starter set for modules
 * landing next are defined here — each subsequent Phase 5 module adds its
 * own permissions to this file as it ships, per "every feature must be
 * testable" / traceable-to-an-enforcement-point discipline.
 */
export interface PermissionDefinition {
  key: string;
  resource: string;
  action: string;
  description: string;
}

export const PERMISSIONS_CATALOGUE: PermissionDefinition[] = [
  // Tenancy / company administration
  { key: 'company:manage', resource: 'company', action: 'manage', description: 'Edit company profile, settings, and branding.' },
  { key: 'company:billing', resource: 'company', action: 'billing', description: 'View and manage subscription/billing.' },

  // Identity / user & role administration
  { key: 'users:invite', resource: 'users', action: 'invite', description: 'Invite new users to the company.' },
  { key: 'users:manage', resource: 'users', action: 'manage', description: 'Deactivate users, change their assigned role.' },
  { key: 'roles:manage', resource: 'roles', action: 'manage', description: "Create/edit the company's custom roles and permission grants." },

  // Audit
  { key: 'audit:read', resource: 'audit', action: 'read', description: 'View the audit trail and per-entity history.' },

  // Files
  { key: 'files:read', resource: 'files', action: 'read', description: 'View/download file attachments.' },
  { key: 'files:write', resource: 'files', action: 'write', description: 'Upload/delete file attachments.' },

  // Catalog
  { key: 'products:read', resource: 'products', action: 'read', description: 'View product catalog.' },
  { key: 'products:write', resource: 'products', action: 'write', description: 'Create/edit products.' },
  { key: 'units:manage', resource: 'units', action: 'manage', description: 'Manage the company unit-of-measure list.' },
  { key: 'suppliers:read', resource: 'suppliers', action: 'read', description: 'View suppliers.' },
  { key: 'suppliers:write', resource: 'suppliers', action: 'write', description: 'Create/edit suppliers.' },
  { key: 'settings:manage', resource: 'settings', action: 'manage', description: 'Edit company settings and branding.' },
  { key: 'legacy-import:manage', resource: 'legacy-import', action: 'manage', description: 'Connect and run external data-import sources, e.g. the SH ERP Import Connector for Google Sheets (admin-only: writes across nearly every module).' },

  // Inventory
  { key: 'warehouses:manage', resource: 'warehouses', action: 'manage', description: 'Create/edit warehouses.' },
  { key: 'stock:read', resource: 'stock', action: 'read', description: 'View stock levels and movement history.' },
  { key: 'stock:adjust', resource: 'stock', action: 'adjust', description: 'Record stock movements (receive/issue/adjust/move/write-off).' },
  { key: 'inventory-sessions:manage', resource: 'inventory-sessions', action: 'manage', description: 'Run stocktakes (inventory sessions).' },

  // BOM
  { key: 'assemblies:read', resource: 'assemblies', action: 'read', description: 'View assemblies and their BOM.' },
  { key: 'assemblies:write', resource: 'assemblies', action: 'write', description: 'Create/edit assemblies and BOM lines, save new BOM versions.' },

  // Production
  { key: 'production-orders:read', resource: 'production-orders', action: 'read', description: 'View production orders.' },
  { key: 'production-orders:manage', resource: 'production-orders', action: 'manage', description: 'Plan, start, advance, and complete production orders.' },
  { key: 'production-orders:delete', resource: 'production-orders', action: 'delete', description: 'Permanently delete a production order (planned or cancelled only) — admin-only, not granted to any default role besides Admin.' },
  { key: 'production-stages:manage', resource: 'production-stages', action: 'manage', description: 'Configure the company\'s production stage list (admin-only in the legacy RBAC matrix, Phase 1 §5).' },
  { key: 'finished-goods:read', resource: 'finished-goods', action: 'read', description: 'View finished goods / serials.' },
  { key: 'finished-goods:manage', resource: 'finished-goods', action: 'manage', description: 'Receive units bought ready-made from a supplier directly onto stock, without a production order.' },
  { key: 'finished-goods:delete', resource: 'finished-goods', action: 'delete', description: 'Permanently delete a finished-good unit (IN_STOCK only) — admin-only, not granted to any default role besides Admin.' },

  // Production-labor module (2026-08-24): recording/confirming labor
  // against a ProductionOrder batch or a standalone GENERAL WorkTask.
  { key: 'production-executions:read', resource: 'production-executions', action: 'read', description: 'View recorded labor executions and their allocations.' },
  { key: 'production-executions:record', resource: 'production-executions', action: 'record', description: 'Record/edit a DRAFT labor execution.' },
  { key: 'production-executions:confirm', resource: 'production-executions', action: 'confirm', description: 'Confirm a DRAFT execution (generates PayrollEntry rows), or void/correct a CONFIRMED one.' },
  { key: 'work-tasks:manage', resource: 'work-tasks', action: 'manage', description: 'Create/edit GENERAL work tasks (non-product labor with a manually-set fund) and their informational product tags.' },

  // Quality — split into checklist configuration (admin-only, legacy matrix) vs. recording a check (admin+storekeeper-equivalent roles)
  { key: 'qc-checklist:manage', resource: 'qc-checklist', action: 'manage', description: 'Configure the QC checklist item list (admin-only in the legacy RBAC matrix, Phase 1 §5).' },
  { key: 'qc:record', resource: 'qc', action: 'record', description: 'Record a QC check result against a finished good.' },

  // Procurement
  { key: 'purchase-orders:read', resource: 'purchase-orders', action: 'read', description: 'View purchase orders.' },
  { key: 'purchase-orders:manage', resource: 'purchase-orders', action: 'manage', description: 'Create/edit purchase orders and record receiving.' },
  { key: 'purchase-orders:delete', resource: 'purchase-orders', action: 'delete', description: 'Permanently delete a purchase order — admin-only, not granted to any default role besides Admin.' },

  // Finance — PO documents/expenses/payments (Finance module, 2026-08-24).
  // Admin-only by default, same sensitivity rationale as `reports:valuation`
  // (exposes invoice amounts and payment records) — companies can grant it
  // to a custom role if they want procurement staff to see/manage it too.
  { key: 'finance:read', resource: 'finance', action: 'read', description: 'View PO financial documents, expenses, payments, and summaries.' },
  { key: 'finance:manage', resource: 'finance', action: 'manage', description: 'Create/edit PO financial documents, expenses, and record payments.' },
  { key: 'finance:delete', resource: 'finance', action: 'delete', description: 'Delete a PO financial document, expense, or payment — admin-only, not granted to any default role besides Admin.' },

  // Sales
  { key: 'customer-orders:read', resource: 'customer-orders', action: 'read', description: 'View customer orders.' },
  { key: 'customer-orders:manage', resource: 'customer-orders', action: 'manage', description: 'Create/edit customer orders, give lines to production, preview and create shortage-driven purchase orders.' },
  { key: 'customer-orders:delete', resource: 'customer-orders', action: 'delete', description: 'Permanently delete a customer order — admin-only, not granted to any default role besides Admin.' },
  { key: 'shipments:read', resource: 'shipments', action: 'read', description: 'View shipments.' },
  { key: 'shipments:manage', resource: 'shipments', action: 'manage', description: 'Create/edit shipments, mark delivered.' },

  // HR
  { key: 'employees:manage', resource: 'employees', action: 'manage', description: 'Manage employee records.' },
  { key: 'teams:manage', resource: 'teams', action: 'manage', description: 'Manage brigades/teams — presets of worker composition used to prefill a labor execution\'s allocations. Never a payroll unit itself.' },

  // Reports
  { key: 'reports:read', resource: 'reports', action: 'read', description: 'View operational reports (reorder suggestions, monthly production rollup).' },
  { key: 'reports:valuation', resource: 'reports', action: 'valuation', description: 'View the warehouse value report — admin-only in the legacy RBAC matrix because it exposes cost/price data (Phase 1 §5).' },

  // Payroll — called out explicitly since it's the field-sensitivity
  // example used throughout Phase 2 (§6's "price-stripping" successor).
  { key: 'payroll:manage', resource: 'payroll', action: 'manage', description: 'View and record payroll entries.' },
  { key: 'payroll-periods:manage', resource: 'payroll-periods', action: 'manage', description: 'Open/close payroll periods. A closed period blocks new/confirmed/voided payroll-affecting entries dated inside it — admin-only, not granted to any default role besides Admin.' },

  // AI
  { key: 'ai:use', resource: 'ai', action: 'use', description: 'Ask the help assistant or full AI assistant (available to every default role in the legacy RBAC matrix, Phase 1 §5).' },
  { key: 'ai:use-critical-actions', resource: 'ai', action: 'use-critical-actions', description: 'Confirm AI-proposed actions that mutate data (e.g. stock adjustments).' },
  { key: 'ai:settings-manage', resource: 'ai', action: 'settings-manage', description: 'Configure the company AI settings (bring-your-own API key, usage quota) — admin-only in the legacy RBAC matrix, same row as the Gemini key (Phase 1 §5).' },
];

/**
 * Default (`isSystem = true`) roles seeded per company (Phase 2 §6 / Phase 3
 * §7) — richer than the old system's hardcoded 3 (admin/storekeeper/viewer,
 * Phase 1 §1.2), per the owner's flexible-RBAC requirement. Companies can
 * still edit these (they're not locked, just not deletable — `isSystem`).
 */
export const DEFAULT_ROLES = [
  { name: 'Admin', permissions: PERMISSIONS_CATALOGUE.map((p) => p.key) },
  {
    name: 'Storekeeper',
    permissions: [
      'products:read', 'products:write', 'units:manage', 'suppliers:read',
      'warehouses:manage', 'stock:read', 'stock:adjust', 'inventory-sessions:manage',
      'purchase-orders:read', 'finished-goods:read', 'finished-goods:manage', 'shipments:read', 'files:read', 'files:write',
      // AI: full RBAC-matrix parity with the legacy "storekeeper" role — both
      // basic AI use and confirming a critical action (Phase 1 §5's AI rows).
      'ai:use', 'ai:use-critical-actions',
    ],
  },
  {
    name: 'Production',
    permissions: [
      'products:read', 'assemblies:read', 'assemblies:write',
      'production-orders:read', 'production-orders:manage', 'finished-goods:read', 'finished-goods:manage',
      'qc:record', 'stock:read', 'files:read', 'files:write', 'ai:use',
      // Production-labor module (2026-08-24): the shop-floor foreman role
      // records AND confirms its own executions — this codebase has no
      // separate "Supervisor" role yet, so both tiers are bundled here,
      // same as production-orders:manage already bundling start/advance.
      'production-executions:read', 'production-executions:record', 'production-executions:confirm',
      'work-tasks:manage', 'teams:manage',
    ],
  },
  {
    name: 'Sales',
    permissions: [
      'products:read', 'assemblies:read', 'customer-orders:read', 'customer-orders:manage',
      'shipments:read', 'shipments:manage', 'finished-goods:read', 'stock:read', 'files:read', 'files:write', 'ai:use',
    ],
  },
  {
    name: 'Viewer',
    permissions: [
      'products:read', 'assemblies:read', 'stock:read', 'production-orders:read',
      'customer-orders:read', 'purchase-orders:read', 'finished-goods:read', 'shipments:read', 'reports:read',
      // AI: legacy matrix grants viewer both simple + full assistant use, just
      // never `ai:use-critical-actions` (viewer can't confirm mutating actions).
      'ai:use',
    ],
  },
] as const;
