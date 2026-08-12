/**
 * Ported field-for-field from the legacy `ImportExport.gs` (`FIELD_SYNONYMS`,
 * `normalizeHeader_`, `buildHeaderMap_`, `EXPORT_HEADERS`) — the "smart
 * import" that lets a user's spreadsheet have column headers in any
 * language/casing/abbreviation (Ukrainian/Russian/English) and still get
 * matched to the right Product field, rather than requiring an exact
 * template. See ImportExport.gs's own header comment (kept verbatim in the
 * Ukrainian original there) for why: real supplier/customer price lists
 * never use this system's exact column names.
 *
 * Two deliberate scope changes from the legacy version, both because the
 * schema changed underneath this feature, not because the matching logic
 * changed:
 *  - `unit` used to be free text stored directly on the product row; it's
 *    now `Product.unitId`, a required FK to `CompanyUnit` (Phase 3 decision
 *    1). The synonym dictionary below still recognizes the same header
 *    names, but `ProductsImportExportService` resolves the matched text to
 *    a `CompanyUnit` by name (auto-creating one if it doesn't exist yet —
 *    see that service's header comment) instead of writing a string.
 *  - `qty` ("Залишок") is no longer a directly-settable Product column — see
 *    the atomic stock ledger note in backend/README.md. The synonym is kept
 *    (a real column in real supplier files) but the service applies it as a
 *    `StockService` movement, never a raw `Product.qty` write.
 *  - `photoUrl` has no analog in the new schema as a Product COLUMN —
 *    `Product` has no photo field at all; photos are `FileAsset`
 *    attachments. It's no longer ignored on import, though: a recognized
 *    `photoUrl` column is read by `ProductsImportExportService` and, if it
 *    holds a Google Drive share link, fetched (public/unauthenticated —
 *    only works for files shared "anyone with the link") and attached as
 *    the product's PRODUCT_PHOTO, the same way an embedded picture in the
 *    row is. It's just never written as a Product text/numeric column.
 */

export const EXPORT_HEADERS = [
  'Код', 'Артикул', 'Назва', 'Опис',
  'Категорія', 'Товарна група', 'Сімейство', 'Тип', 'Вид', 'Виріб', 'Штрих-код',
  'Одиниця', 'К-сть в упаковці', 'Місце зберігання', 'Залишок', 'К-сть в упаковках', 'Мін.залишок',
  'Ціна наша без ПДВ (EUR)', 'Ціна наша з ПДВ (EUR)', 'Ціна німецька без ПДВ (EUR)', 'Ціна німецька з ПДВ (EUR)', 'Ціна продажу (EUR)',
  'Вага за од. (кг)', 'Вага в наявності (кг)', 'Термін гарантії', 'Статус',
  'Виробник', 'Код виробника', 'Країна виробника',
  'Прайс-лист', 'Примітка', 'Фото URL',
] as const;

/**
 * Synonym dictionary -> internal field key. Keys are compared normalized
 * (see `normalizeHeader`). IMPORTANT, kept from the legacy comment verbatim:
 * longer/more specific phrases must come BEFORE shorter ones within the
 * same field, because the first found match wins — e.g. "ціна наша з пдв"
 * must be recognized before the plain "ціна наша" it also partially matches.
 */
export const FIELD_SYNONYMS: Record<string, string[]> = {
  article: ['артикул', 'арт', 'sku', 'article', 'code'],
  code: ['код', 'внутрішній код', 'внутренний код', 'internal code', 'id товару'],
  name: ['назва', 'название', 'найменування', 'name', 'товар'],
  description: ['опис', 'описание', 'description', 'детальний опис'],
  category: ['категорія', 'категория', 'category'],
  productGroup: ['товарна група', 'товарная группа', 'product group', 'группа', 'група'],
  family: ['сімейство', 'семейство', 'family'],
  type: ['тип', 'type'],
  kind: ['вид', 'kind'],
  productLine: ['виріб', 'изделие', 'product line', 'лінія продукту'],
  barcode: ['штрих-код', 'штрих код', 'штрихкод', 'barcode', 'ean'],
  unit: ['одиниця виміру', 'одиниця', 'единица измерения', 'единица', 'unit', 'од.вим'],
  unitsPerPackage: ['к-сть в упаковці', 'кількість в упаковці', 'штук в упаковке', 'units per package', 'в упаковці'],
  cell: ['місце зберігання', 'место хранения', 'комірка', 'ячейка', 'cell', 'локація', 'стелаж'],
  qty: ['залишок', 'кількість', 'кол-во', 'количество', 'остаток', 'qty', 'quantity', 'наявність'],
  minQty: ['мінімальний залишок', 'мін.залишок', 'мин остаток', 'минимальный остаток', 'min qty', 'мін'],
  localPriceExclVat: ['ціна наша без пдв', 'цена наша без ндс', 'ціна наша', 'цена наша', 'local price excl vat', 'постачальник 1 без пдв'],
  localPriceInclVat: ['ціна наша з пдв', 'цена наша с ндс', 'local price incl vat', 'постачальник 1 з пдв', 'ціна1'],
  germanPriceExclVat: ['ціна німецька без пдв', 'ціна німеччина без пдв', 'цена немецкая без ндс', 'german price excl vat', 'постачальник 2 без пдв'],
  germanPriceInclVat: ['ціна німецька з пдв', 'ціна німеччина', 'цена немецкая', 'german price', 'постачальник 2', 'ціна2'],
  sellPriceEur: ['ціна продажу', 'цена продажи', 'sell price', 'selling price', 'ціна реалізації'],
  weightPerUnitKg: ['вага за од', 'вага за одиницю', 'вес за ед', 'weight per unit', 'вага'],
  warrantyMonths: ['термін гарантії', 'срок гарантии', 'warranty', 'гарантія'],
  status: ['статус', 'status'],
  manufacturer: ['виробник', 'производитель', 'manufacturer'],
  manufacturerCode: ['код виробника', 'код производителя', 'manufacturer code', 'oem'],
  countryOfOrigin: ['країна виробника', 'страна производителя', 'country of origin', 'країна походження'],
  priceListRef: ['прайс-лист', 'прайс лист', 'price list', 'прайслист'],
  note: ['примітка', 'примечание', 'note', 'коментар'],
  photoUrl: ['фото url', 'photo url', 'фото', 'photo', 'зображення', 'image url', 'image', 'посилання на фото'],
};

const FIELD_ORDER = Object.keys(FIELD_SYNONYMS); // order determines priority on ambiguity, same as legacy

export function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/["'’]/g, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Determines the "file header -> internal field" mapping once for the whole
 * import. For each header, the LONGEST matching synonym wins (so "ціна
 * наша" doesn't shadow "ціна наша з пдв" when both could partially match).
 */
export function buildHeaderMap(rawHeaders: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const raw of rawHeaders) {
    // Client-supplied service fields (none currently produced by this
    // backend's import UI, unlike legacy's client-side _photoBase64) would
    // land here as an underscore-prefixed key — skip them the same way
    // legacy did, in case a future exporter ever adds one.
    if (String(raw).indexOf('_') === 0) continue;

    const norm = normalizeHeader(raw);
    let bestField: string | null = null;
    let bestLen = -1;

    for (const field of FIELD_ORDER) {
      for (const syn of FIELD_SYNONYMS[field]) {
        if ((norm === syn || norm.indexOf(syn) !== -1) && syn.length > bestLen) {
          bestField = field;
          bestLen = syn.length;
        }
      }
    }

    if (bestField) map[raw] = bestField;
  }
  return map;
}

export const NUMERIC_FIELDS = [
  'qty', 'minQty', 'unitsPerPackage',
  'localPriceExclVat', 'localPriceInclVat', 'germanPriceExclVat', 'germanPriceInclVat',
  'sellPriceEur', 'weightPerUnitKg',
];

/** Fields recognized in headers but never written as a plain Product column — each has its own dedicated handling instead (`qty` -> StockService, `photoUrl` -> FilesService; see this file's header comment). Currently empty: kept as a named list (rather than removed outright) in case a future column needs the same "recognized but not a direct column" treatment. */
export const IGNORED_ON_IMPORT_FIELDS: string[] = [];

export type MappedProductRow = Record<string, string | number>;

export function mapRowToProduct(row: Record<string, unknown>, headerMap: Record<string, string>): MappedProductRow {
  const out: MappedProductRow = {};
  for (const rawHeader of Object.keys(row)) {
    const field = headerMap[rawHeader];
    if (!field || IGNORED_ON_IMPORT_FIELDS.includes(field)) continue;
    const raw = row[rawHeader];
    if (NUMERIC_FIELDS.includes(field)) {
      const parsed = parseFloat(String(raw ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
      out[field] = Number.isFinite(parsed) ? parsed : 0;
    } else {
      out[field] = String(raw ?? '').trim();
    }
  }
  return out;
}
