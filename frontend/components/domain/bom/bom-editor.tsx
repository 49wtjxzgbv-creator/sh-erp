'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { useAssemblyComponents, useSetAssemblyComponents } from '@/lib/hooks/use-bom';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { toNumber } from '@/lib/api-client/decimal';
import type { AssemblyComponentLineInput, ComponentType } from '@/lib/api-client/bom';
import { ProductPicker } from '@/components/domain/catalog/product-picker';
import { AssemblyPicker } from '@/components/domain/bom/assembly-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface EditableRow {
  key: string;
  componentType: ComponentType;
  productId?: string;
  subAssemblyId?: string;
  warehouseId?: string;
  qtyPerUnit: string;
  /**
   * Display label for the picked product/sub-assembly. Only populated when
   * the user picks a row in this session, or reconstructed for rows loaded
   * from the server via the id-only fallback below — same documented
   * limitation as Inventory's stock tables (no batch products-by-ids
   * endpoint yet), see frontend/README.md.
   */
  label: string;
}

let rowKeySeq = 0;
function newRowKey() {
  rowKeySeq += 1;
  return `row-${rowKeySeq}`;
}

export interface BomEditorProps {
  assemblyId: string;
  /** View-only for a role with `assemblies:read` but not `assemblies:write` — disables every field via a `<fieldset>` wrap and hides Add line/Save. */
  readOnly?: boolean;
}

export function BomEditor({ assemblyId, readOnly }: BomEditorProps) {
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: serverComponents, isLoading } = useAssemblyComponents(assemblyId);
  const { data: warehouses } = useWarehouses();
  const setComponents = useSetAssemblyComponents(assemblyId);

  const [rows, setRows] = useState<EditableRow[]>([]);
  const hydrated = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (hydrated.current || !serverComponents) return;
    hydrated.current = true;
    setRows(
      serverComponents.map((c) => ({
        key: newRowKey(),
        componentType: c.componentType,
        productId: c.productId ?? undefined,
        subAssemblyId: c.subAssemblyId ?? undefined,
        warehouseId: c.warehouseId ?? undefined,
        qtyPerUnit: String(toNumber(c.qtyPerUnit) ?? ''),
        label: (c.productId ?? c.subAssemblyId ?? '') as string,
      })),
    );
  }, [serverComponents]);

  function addRow() {
    setRows((r) => [...r, { key: newRowKey(), componentType: 'PRODUCT', qtyPerUnit: '', label: '' }]);
  }

  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
  }

  function updateRow(key: string, patch: Partial<EditableRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function handleSave() {
    setError(null);
    setSaved(false);

    const payload: AssemblyComponentLineInput[] = [];
    for (const row of rows) {
      const qty = Number(row.qtyPerUnit);
      if (!qty || qty <= 0) {
        setError(t('invalidRow'));
        return;
      }
      if (row.componentType === 'PRODUCT') {
        if (!row.productId) {
          setError(t('invalidRow'));
          return;
        }
        payload.push({ componentType: 'PRODUCT', productId: row.productId, warehouseId: row.warehouseId, qtyPerUnit: qty });
      } else {
        if (!row.subAssemblyId) {
          setError(t('invalidRow'));
          return;
        }
        payload.push({ componentType: 'ASSEMBLY', subAssemblyId: row.subAssemblyId, warehouseId: row.warehouseId, qtyPerUnit: qty });
      }
    }

    try {
      await setComponents.mutateAsync(payload);
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
      <fieldset disabled={readOnly} className="contents">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">{t('componentType')}</TableHead>
            <TableHead>{t('component')}</TableHead>
            <TableHead className="w-36">{t('warehouseOptional')}</TableHead>
            <TableHead className="w-28">{t('qtyPerUnit')}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <Select
                    value={row.componentType}
                    onValueChange={(v) =>
                      updateRow(row.key, {
                        componentType: v as ComponentType,
                        productId: undefined,
                        subAssemblyId: undefined,
                        label: '',
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRODUCT">{t('componentTypeProduct')}</SelectItem>
                      <SelectItem value="ASSEMBLY">{t('componentTypeAssembly')}</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {row.componentType === 'PRODUCT' ? (
                    <ProductPicker
                      value={row.productId}
                      onChange={(id, label) => updateRow(row.key, { productId: id, label: label ?? '' })}
                    />
                  ) : (
                    <AssemblyPicker
                      value={row.subAssemblyId}
                      excludeId={assemblyId}
                      onChange={(id, label) => updateRow(row.key, { subAssemblyId: id, label: label ?? '' })}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    value={row.warehouseId ?? '__none__'}
                    onValueChange={(v) => updateRow(row.key, { warehouseId: v === '__none__' ? undefined : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {warehouses?.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="any"
                    min={0}
                    value={row.qtyPerUnit}
                    onChange={(e) => updateRow(row.key, { qtyPerUnit: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => removeRow(row.key)}>
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
        {t('addLine')}
      </Button>
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && <p className="text-sm text-success">{t('bomSaved')}</p>}

      {!readOnly && (
        <div>
          <Button onClick={handleSave} loading={setComponents.isPending}>
            {t('saveBom')}
          </Button>
        </div>
      )}
    </div>
  );
}
