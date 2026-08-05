/**
 * Tracks legacyId -> new-UUID per entity namespace during transform.
 * Every entity created in transform gets `legacyId` set to its source row's
 * stable identifier (Phase 4 design doc §2.2, closing paragraph) — this is
 * the mechanism that makes load idempotent (upsert-by-`(companyId, legacyId)`,
 * §2.3) and the backbone of FK resolution across sheets (e.g. resolving
 * `Product.defaultSupplierId` from a `Suppliers` sheet legacy row id).
 *
 * Namespaced (not one flat map) because different sheets' legacy `ID`
 * columns are only unique WITHIN their own sheet — a Products.gs row with
 * `ID = "abc123"` and a Suppliers.gs row with `ID = "abc123"` are unrelated,
 * and the old system's `newId_()` (Code.gs) generating plain random tokens
 * gives no cross-sheet collision guarantee either way.
 */
export class LegacyIdMap {
  private readonly namespaces = new Map<string, Map<string, string>>();

  set(namespace: string, legacyId: string, newId: string): void {
    if (!legacyId) return;
    let ns = this.namespaces.get(namespace);
    if (!ns) {
      ns = new Map();
      this.namespaces.set(namespace, ns);
    }
    ns.set(legacyId, newId);
  }

  get(namespace: string, legacyId: string | null | undefined): string | undefined {
    if (!legacyId) return undefined;
    return this.namespaces.get(namespace)?.get(legacyId);
  }

  has(namespace: string, legacyId: string | null | undefined): boolean {
    return this.get(namespace, legacyId) !== undefined;
  }

  size(namespace: string): number {
    return this.namespaces.get(namespace)?.size ?? 0;
  }
}
