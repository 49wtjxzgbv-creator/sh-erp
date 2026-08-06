// Copied verbatim from migration-toolkit/src/transform/id-map.ts (2026-08-07)
// — see transform/types.ts's header comment for why this is a copy, not an
// import.

/**
 * Tracks legacyId -> new-UUID per entity namespace during transform.
 * Namespaced (not one flat map) because different sheets' legacy `ID`
 * columns are only unique WITHIN their own sheet.
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
