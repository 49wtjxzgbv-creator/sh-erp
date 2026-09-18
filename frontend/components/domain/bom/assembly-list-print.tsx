'use client';

import { useTranslations } from 'next-intl';
import { useAssemblyCosts } from '@/lib/hooks/use-bom';
import { useSuppliers } from '@/lib/hooks/use-procurement';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { useEurUahRate } from '@/lib/hooks/use-eur-uah-rate';
import { formatEurAndUah } from '@/lib/utils';
import type { Assembly } from '@/lib/api-client/bom';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption, type PrintRowOption } from '@/components/domain/print/print-options';
import { EurUahRateField } from '@/components/domain/sales/eur-uah-rate-field';
import { Avatar } from '@/components/ui/avatar';

/**
 * "Друк списку специфікацій" (2026-09-18 user request — "роздрукувати
 * списком номер специфікації, фото, назву, вартість праці і ще якісь
 * стовпці які вибрати"): unlike AssemblySpecPrint (one assembly's own
 * component/materials breakdown), this prints the REGISTRY itself — one
 * row per specification, the same column set bom/page.tsx's on-screen
 * `ColumnVisibilityMenu` already offers (article/name/laborCostPerUnit/
 * note/packaging/delivery/other/supplier/createdAt/full itemCost), plus
 * the row checklist so staff can print all or only some specifications.
 *
 * Deliberately scoped to `assemblies` as given — the CURRENT loaded page
 * from bom/page.tsx (its own search/pagination), not a second "fetch
 * everything across every page" query of its own; printing "the list you're
 * currently looking at" is what was asked for, and matches the row-select
 * UI itself (a checklist you can actually see the whole of already implies
 * a bounded page, not an unbounded fetch-everything result set).
 *
 * Fetches photos/costs/suppliers itself rather than taking them as props:
 * `laborCostPerUnit` etc. are already inline fields on `Assembly` (no extra
 * fetch), but `itemCost` (full BOM-derived cost) and supplier names need
 * their own batched calls — same query keys bom/page.tsx's own on-screen
 * table already uses (assemblies/:id/cost, suppliers), so React Query just
 * reuses whatever's already cached instead of double-fetching. Doing this
 * here rather than threading the page's own state down also means the
 * print view has real cost data available even when the on-screen "К-сть"
 * column is currently hidden (that toggle skips its OWN fetch to avoid
 * dozens of per-row cost calls when nobody's looking at that column).
 */
export function AssemblyListPrint({ assemblies }: { assemblies: Assembly[] }) {
  const t = useTranslations('bom');
  const tp = useTranslations('print');

  const assemblyIds = assemblies.map((a) => a.id);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');
  const { data: suppliers } = useSuppliers({ limit: 200 });
  const itemCosts = useAssemblyCosts(assemblyIds);

  const supplierById = new Map((suppliers?.items ?? []).map((s) => [s.id, s.name]));

  const columns: PrintColumnOption[] = [
    { id: 'article', label: t('article') },
    { id: 'name', label: t('name') },
    { id: 'laborCostPerUnit', label: t('laborCostPerUnit') },
    { id: 'note', label: t('note') },
    { id: 'packagingCostPerUnit', label: t('packagingCostPerUnit') },
    { id: 'deliveryCostPerUnit', label: t('deliveryCostPerUnit') },
    { id: 'otherCostPerUnit', label: t('otherCostPerUnit') },
    { id: 'supplier', label: t('supplier') },
    { id: 'createdAt', label: t('createdAt') },
    { id: 'itemCost', label: t('itemCost') },
  ];
  const rows: PrintRowOption[] = assemblies.map((a) => ({ id: a.id, label: a.article ? `${a.article} — ${a.name}` : a.name }));
  const printOptions = usePrintOptions({ columns, hasPhotos: true, id: 'assembly-list-print' });
  // "Курс EUR -> UAH" (2026-09-18 user request — "додай для друку
  // можливість конвертувати євро в гривні і вводити курс вручну"): every
  // EUR cost cell below also shows its exact UAH equivalent in parens once
  // a rate is entered (formatEurAndUah — NOT payroll's round-up-to-100
  // rule, see that helper's own doc comment). Not part of PrintOptions'
  // column set: it's a per-print rate entry, not a fixed column to toggle.
  const [eurUahRate, setEurUahRate] = useEurUahRate();

  const visibleAssemblies = assemblies.filter((a) => printOptions.isRowVisible(a.id));

  return (
    <>
      <div className="flex gap-2">
        <PrintOptionsDialog
          open={printOptions.open}
          onOpenChange={printOptions.setOpen}
          columns={columns}
          hasPhotos
          rows={rows}
          onConfirm={printOptions.confirm}
          triggerLabel={tp('printSpecificationsList')}
        />
        <PreviewButton printAreaId={printOptions.printAreaId} />
        <EurUahRateField rate={eurUahRate} onChange={setEurUahRate} />
      </div>
      <PrintArea printAreaId={printOptions.printAreaId}>
        <PrintDocumentHeader title={tp('specificationsListTitle')} />
        <table>
          <thead>
            <tr>
              <th>#</th>
              {printOptions.includePhotos && <th className="print-photo-col">{tp('photoColumn')}</th>}
              {printOptions.isColumnVisible('article') && <th>{t('article')}</th>}
              {printOptions.isColumnVisible('name') && <th>{t('name')}</th>}
              {printOptions.isColumnVisible('laborCostPerUnit') && <th>{t('laborCostPerUnit')}</th>}
              {printOptions.isColumnVisible('note') && <th>{t('note')}</th>}
              {printOptions.isColumnVisible('packagingCostPerUnit') && <th>{t('packagingCostPerUnit')}</th>}
              {printOptions.isColumnVisible('deliveryCostPerUnit') && <th>{t('deliveryCostPerUnit')}</th>}
              {printOptions.isColumnVisible('otherCostPerUnit') && <th>{t('otherCostPerUnit')}</th>}
              {printOptions.isColumnVisible('supplier') && <th>{t('supplier')}</th>}
              {printOptions.isColumnVisible('createdAt') && <th>{t('createdAt')}</th>}
              {printOptions.isColumnVisible('itemCost') && <th>{t('itemCost')}</th>}
            </tr>
          </thead>
          <tbody>
            {visibleAssemblies.map((a, i) => {
              const costIndex = assemblies.indexOf(a);
              const cost = itemCosts[costIndex]?.data?.costPerUnit;
              return (
                <tr key={a.id}>
                  <td>{i + 1}</td>
                  {printOptions.includePhotos && (
                    <td>
                      <Avatar src={photosByAssembly?.[a.id]?.[0]?.downloadUrl} size="lg" />
                    </td>
                  )}
                  {printOptions.isColumnVisible('article') && <td className="font-bold">{a.article ?? ''}</td>}
                  {printOptions.isColumnVisible('name') && <td>{a.name}</td>}
                  {printOptions.isColumnVisible('laborCostPerUnit') && <td>{formatEurAndUah(Number(a.laborCostPerUnit), eurUahRate)}</td>}
                  {printOptions.isColumnVisible('note') && <td>{a.note ?? ''}</td>}
                  {printOptions.isColumnVisible('packagingCostPerUnit') && <td>{formatEurAndUah(Number(a.packagingCostPerUnit), eurUahRate)}</td>}
                  {printOptions.isColumnVisible('deliveryCostPerUnit') && <td>{formatEurAndUah(Number(a.deliveryCostPerUnit), eurUahRate)}</td>}
                  {printOptions.isColumnVisible('otherCostPerUnit') && <td>{formatEurAndUah(Number(a.otherCostPerUnit), eurUahRate)}</td>}
                  {printOptions.isColumnVisible('supplier') && <td>{a.defaultSupplierId ? (supplierById.get(a.defaultSupplierId) ?? '') : ''}</td>}
                  {printOptions.isColumnVisible('createdAt') && <td>{new Date(a.createdAt).toLocaleDateString()}</td>}
                  {printOptions.isColumnVisible('itemCost') && <td>{cost != null ? formatEurAndUah(cost, eurUahRate) : ''}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </PrintArea>
    </>
  );
}
