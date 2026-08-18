'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { useProductSuppliers, useSetProductSuppliers } from '@/lib/hooks/use-catalog';
import { useAssemblySuppliers, useSetAssemblySuppliers } from '@/lib/hooks/use-bom';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { toNumber } from '@/lib/api-client/decimal';
import { SupplierPicker } from '@/components/domain/procurement/supplier-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface EditableRow {
  key: string;
  supplierId?: string;
  supplierLabel: string;
  price: string;
  isDefault: boolean;
}

let rowKeySeq = 0;
function newRowKey() {
  rowKeySeq += 1;
  return `supplier-row-${rowKeySeq}`;
}

export interface EntitySuppliersEditorProps {
  entityType: 'Product' | 'Assembly';
  entityId: string;
}

/**
 * Multi-supplier link editor, each row with its own optional price —
 * reused by both the Product form (Catalog) and the Assembly detail page
 * ("виріб"), which hit two different REST endpoints (products/:id/suppliers
 * vs assemblies/:id/suppliers) but share the exact same row-list UX. Mirrors
 * BomEditor's replace-set pattern: the full list is re-saved on every
 * "Зберегти", no partial-update endpoint, same convention as BOM lines.
 *
 * A product/assembly with exactly one linked row here is auto-resolved by
 * the shortage engine, same as it always resolved `defaultSupplierId`; with
 * more than one, ordering time prompts the user to pick which supplier —
 * that's the whole reason this editor exists instead of the old single
 * `defaultSupplierId` field (kept, unchanged, as the fallback when a
 * product/assembly has zero rows here).
 */
export function EntitySuppliersEditor({ entityType, entityId }: EntitySuppliersEditorProps) {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const isProduct = entityType === 'Product';
  const { data: productLinks, isLoading: productLoading } = useProductSuppliers(isProduct ? entityId : undefined);
  const { data: assemblyLinks, isLoading: assemblyLoading } = useAssemblySuppliers(isProduct ? undefined : entityId);
  const serverLinks = isProduct ? productLinks : assemblyLinks;
  const isLoading = isProduct ? productLoading : assemblyLoading;

  const setProductSuppliers = useSetProductSuppliers(entityId);
  const setAssemblySuppliers = useSetAssemblySuppliers(entityId);
  const setSuppliers = isProduct ? setProductSuppliers : setAssemblySuppliers;

  const [rows, setRows] = useState<EditableRow[]>([]);
  const hydrated = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (hydrated.current || !serverLinks) return;
    hydrated.current = true;
    setRows(
      serverLinks.map((l) => ({
        key: newRowKey(),
        supplierId: l.supplierId,
        supplierLabel: l.supplierName,
        price: toNumber(l.price) != null ? String(toNumber(l.price)) : '',
        isDefault: l.isDefault,
      })),
    );
  }, [serverLinks]);

  function addRow() {
    setRows((r) => [...r, { key: newRowKey(), supplierLabel: '', price: '', isDefault: r.length === 0 }]);
  }

  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
  }

  function updateRow(key: string, patch: Partial<EditableRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function setDefault(key: string) {
    setRows((r) => r.map((row) => ({ ...row, isDefault: row.key === key })));
  }

  async function handleSave() {
    setError(null);
    setSaved(false);

    const seen = new Set<string>();
    const payload: { supplierId: string; price?: number; isDefault?: boolean }[] = [];
    for (const row of rows) {
      if (!row.supplierId) {
        setError(t('invalidSupplierRow'));
        return;
      }
      if (seen.has(row.supplierId)) {
        setError(t('duplicateSupplierRow'));
        return;
      }
      seen.add(row.supplierId);
      payload.push({
        supplierId: row.supplierId,
        price: row.price ? Number(row.price) : undefined,
        isDefault: row.isDefault,
      });
    }

    try {
      await setSuppliers.mutateAsync(payload);
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('supplier')}</TableHead>
            <TableHead className="w-36">{t('supplierPrice')}</TableHead>
            <TableHead className="w-24">{t('defaultSupplier')}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <SupplierPicker
                    value={row.supplierId}
                    initialLabel={row.supplierLabel}
                    onChange={(id, label) => updateRow(row.key, { supplierId: id, supplierLabel: label ?? '' })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="any"
                    min={0}
                    value={row.price}
                    onChange={(e) => updateRow(row.key, { price: e.target.value })}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <input
                    type="radio"
                    name={`default-supplier-${entityId}`}
                    checked={row.isDefault}
                    onChange={() => setDefault(row.key)}
                    className="h-4 w-4"
                    aria-label={t('defaultSupplier')}
                  />
                </TableCell>
                <TableCell>
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(row.key)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="mr-2 h-4 w-4" />
        {t('addSupplierLink')}
      </Button>

      {rows.length > 1 && <p className="text-xs text-muted-foreground">{t('multiSupplierHint')}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && <p className="text-sm text-success">{t('suppliersSaved')}</p>}

      <div>
        <Button type="button" onClick={handleSave} loading={setSuppliers.isPending}>
          {tc('save')}
        </Button>
      </div>
    </div>
  );
}
