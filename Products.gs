/**
 * Products.gs — картки товарів: створення, редагування, видалення, пошук, фільтри.
 * Ціни (усі три + похідні "з ПДВ") приховані для ролей storekeeper та viewer.
 */

function rowToProduct_(row, idx) {
  var qty = Number(row[idx.Qty]) || 0;
  var unitsPerPackage = Number(row[idx.UnitsPerPackage]) || 0;
  var weightPerUnit = Number(row[idx.WeightPerUnitKg]) || 0;

  return {
    id: row[idx.ID],
    article: row[idx.Article],
    code: row[idx.Code],
    name: row[idx.Name],
    description: row[idx.Description],
    category: row[idx.Category],
    productGroup: row[idx.ProductGroup],
    family: row[idx.Family],
    type: row[idx.Type],
    kind: row[idx.Kind],
    productLine: row[idx.ProductLine],
    barcode: row[idx.Barcode],
    unit: row[idx.Unit],
    unitsPerPackage: unitsPerPackage,
    cell: row[idx.Cell],
    qty: qty,
    minQty: Number(row[idx.MinQty]) || 0,
    localPriceExclVat: Number(row[idx.LocalPriceExclVat]) || 0,
    localPriceInclVat: Number(row[idx.LocalPriceInclVat]) || 0,
    germanPriceExclVat: Number(row[idx.GermanPriceExclVat]) || 0,
    germanPriceInclVat: Number(row[idx.GermanPriceInclVat]) || 0,
    sellPriceEur: Number(row[idx.SellPriceEUR]) || 0,
    weightPerUnitKg: weightPerUnit,
    warrantyMonths: row[idx.WarrantyMonths],
    status: row[idx.Status],
    manufacturer: row[idx.Manufacturer],
    manufacturerCode: row[idx.ManufacturerCode],
    countryOfOrigin: row[idx.CountryOfOrigin],
    priceListRef: row[idx.PriceListRef],
    note: row[idx.Note],
    photoUrl: row[idx.PhotoUrl],
    createdAt: row[idx.CreatedAt],
    updatedAt: row[idx.UpdatedAt],
    defaultSupplierId: row[idx.DefaultSupplierId] || '',
    // Похідні (обчислювані) значення — зручно мати одразу в об'єкті, не зберігаються окремо:
    packagesCount: unitsPerPackage > 0 ? round2_(qty / unitsPerPackage) : null,
    totalWeightKg: weightPerUnit > 0 ? round2_(weightPerUnit * qty) : null
  };
}

/**
 * Мапа productId -> текст "Артикул — Назва, Артикул2 — Назва2" виробів, у
 * рецепті яких цей товар використовується як ПРЯМИЙ компонент (не рахує
 * вкладеність через інші вироби — тільки "цей товар прямо в специфікації
 * такого-то виробу"). Використовується для колонки "Використовується у
 * виробах" в Таблиці товарів.
 */
function getProductUsageMap_() {
  var ss = getDb_();
  var compSheet = ss.getSheetByName(SHEET_ASSEMBLY_COMPONENTS);
  var compData = compSheet.getDataRange().getValues();
  var compIdx = indexMap_(compData[0]);

  var asmSheet = ss.getSheetByName(SHEET_ASSEMBLIES);
  var asmData = asmSheet.getDataRange().getValues();
  var asmIdx = indexMap_(asmData[0]);
  var assembliesById = {};
  for (var a = 1; a < asmData.length; a++) {
    if (asmData[a][asmIdx.ID]) assembliesById[asmData[a][asmIdx.ID]] = { name: asmData[a][asmIdx.Name], article: asmData[a][asmIdx.Article] || '' };
  }

  var usageIds = {}; // productId -> { assemblyId: true } — щоб не дублювати, якщо товар доданий у виріб двічі
  var usage = {}; // productId -> [{ name, article }]
  for (var i = 1; i < compData.length; i++) {
    var row = compData[i];
    var componentType = row[compIdx.ComponentType] || 'product';
    if (componentType !== 'product') continue;
    var productId = row[compIdx.ProductID];
    var assemblyId = row[compIdx.AssemblyID];
    if (!productId || !assemblyId) continue;
    var asm = assembliesById[assemblyId];
    if (!asm) continue; // виріб видалено

    usageIds[productId] = usageIds[productId] || {};
    if (usageIds[productId][assemblyId]) continue;
    usageIds[productId][assemblyId] = true;

    usage[productId] = usage[productId] || [];
    usage[productId].push(asm);
  }

  var result = {};
  Object.keys(usage).forEach(function (productId) {
    result[productId] = usage[productId].map(function (asm) {
      return (asm.article ? asm.article + ' — ' : '') + asm.name;
    }).join(', ');
  });
  return result;
}

function stripPriceIfNeeded_(product, user) {
  if (user.role !== 'admin') {
    var copy = Object.assign({}, product);
    delete copy.localPriceExclVat;
    delete copy.localPriceInclVat;
    delete copy.germanPriceExclVat;
    delete copy.germanPriceInclVat;
    delete copy.sellPriceEur;
    return copy;
  }
  return product;
}

function listProducts(token) {
  try {
    var user = requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var usageMap = getProductUsageMap_();
    var products = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      var p = stripPriceIfNeeded_(rowToProduct_(row, idx), user);
      p.usedInAssemblies = usageMap[p.id] || '';
      products.push(p);
    }
    return ok_(products);
  } catch (e) {
    return fail_(e.message);
  }
}

function getProduct(token, productId) {
  try {
    var user = requireAuth_(token);
    var found = findProductRow_(productId);
    if (!found) return fail_('Товар не знайдено.');
    return ok_(stripPriceIfNeeded_(rowToProduct_(found.row, found.idx), user));
  } catch (e) {
    return fail_(e.message);
  }
}

function findProductRow_(productId) {
  var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  for (var i = 1; i < data.length; i++) {
    if (data[i][idx.ID] === productId) {
      return { row: data[i], idx: idx, rowNum: i + 1, sheet: sheet };
    }
  }
  return null;
}

/**
 * Пошук за текстовим запитом (артикул/код/назва/опис/категорія/штрихкод/виробник...)
 * ТА/АБО за точними фільтрами (категорія, група, сімейство, тип, вид, виробник, статус, країна).
 * filters — необов'язковий об'єкт { category, productGroup, family, type, kind, manufacturer, status, countryOfOrigin }.
 */
function searchProducts(token, query, filters) {
  try {
    var user = requireAuth_(token);
    query = String(query || '').toLowerCase().trim();
    filters = filters || {};

    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var usageMap = getProductUsageMap_();
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;

      var haystack = [
        row[idx.Article], row[idx.Code], row[idx.Name], row[idx.Description],
        row[idx.Category], row[idx.ProductGroup], row[idx.Family], row[idx.Type], row[idx.Kind],
        row[idx.ProductLine], row[idx.Barcode], row[idx.Manufacturer], row[idx.ManufacturerCode]
      ].join(' ').toLowerCase();

      if (query && haystack.indexOf(query) === -1) continue;

      if (filters.category && row[idx.Category] !== filters.category) continue;
      if (filters.productGroup && row[idx.ProductGroup] !== filters.productGroup) continue;
      if (filters.family && row[idx.Family] !== filters.family) continue;
      if (filters.type && row[idx.Type] !== filters.type) continue;
      if (filters.kind && row[idx.Kind] !== filters.kind) continue;
      if (filters.manufacturer && row[idx.Manufacturer] !== filters.manufacturer) continue;
      if (filters.status && row[idx.Status] !== filters.status) continue;
      if (filters.countryOfOrigin && row[idx.CountryOfOrigin] !== filters.countryOfOrigin) continue;

      var p = stripPriceIfNeeded_(rowToProduct_(row, idx), user);
      p.usedInAssemblies = usageMap[p.id] || '';
      results.push(p);
    }
    return ok_(results);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Повертає унікальні значення для кожного фільтрованого поля — щоб побудувати
 * випадаючі списки фільтрів на клієнті (тільки ті значення, що реально є в базі).
 */
function getFilterOptions(token) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var fields = ['Category', 'ProductGroup', 'Family', 'Type', 'Kind', 'Manufacturer', 'Status', 'CountryOfOrigin'];
    var sets = {};
    fields.forEach(function (f) { sets[f] = {}; });

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      fields.forEach(function (f) {
        var val = row[idx[f]];
        if (val) sets[f][val] = true;
      });
    }

    var result = {};
    fields.forEach(function (f) {
      var key = f.charAt(0).toLowerCase() + f.slice(1);
      result[key] = Object.keys(sets[f]).sort();
    });
    return ok_(result);
  } catch (e) {
    return fail_(e.message);
  }
}

var PRODUCT_EDITABLE_FIELDS_ = {
  article: 'Article', code: 'Code', name: 'Name', description: 'Description',
  category: 'Category', productGroup: 'ProductGroup', family: 'Family', type: 'Type', kind: 'Kind',
  productLine: 'ProductLine', barcode: 'Barcode',
  unit: 'Unit', unitsPerPackage: 'UnitsPerPackage', cell: 'Cell', minQty: 'MinQty',
  localPriceExclVat: 'LocalPriceExclVat', localPriceInclVat: 'LocalPriceInclVat',
  germanPriceExclVat: 'GermanPriceExclVat', germanPriceInclVat: 'GermanPriceInclVat',
  sellPriceEur: 'SellPriceEUR',
  weightPerUnitKg: 'WeightPerUnitKg', warrantyMonths: 'WarrantyMonths', status: 'Status',
  manufacturer: 'Manufacturer', manufacturerCode: 'ManufacturerCode', countryOfOrigin: 'CountryOfOrigin',
  priceListRef: 'PriceListRef', note: 'Note', photoUrl: 'PhotoUrl', defaultSupplierId: 'DefaultSupplierId'
};
var PRICE_FIELDS_ = ['localPriceExclVat', 'localPriceInclVat', 'germanPriceExclVat', 'germanPriceInclVat', 'sellPriceEur'];

function createProduct(token, payload) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    if (!payload.article || !payload.name) return fail_('Артикул і назва обовʼязкові.');

    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idx.Article]).toLowerCase() === String(payload.article).toLowerCase()) {
        return fail_('Товар з таким артикулом вже існує.');
      }
    }

    if (user.role !== 'admin') PRICE_FIELDS_.forEach(function (f) { delete payload[f]; });

    var id = newId_();
    var now = nowStr_();
    var newRow = new Array(Object.keys(idx).length).fill('');

    newRow[idx.ID] = id;
    newRow[idx.Qty] = Number(payload.qty) || 0;
    newRow[idx.CreatedAt] = now;
    newRow[idx.UpdatedAt] = now;

    Object.keys(PRODUCT_EDITABLE_FIELDS_).forEach(function (field) {
      if (payload[field] !== undefined) newRow[idx[PRODUCT_EDITABLE_FIELDS_[field]]] = payload[field];
    });

    sheet.appendRow(newRow);
    logHistory_(user, 'Створення товару', payload.article, payload.name, Number(payload.qty) || 0, 'Початковий залишок');
    return ok_({ id: id });
  } catch (e) {
    return fail_(e.message);
  }
}

function updateProduct(token, productId, payload) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var found = findProductRow_(productId);
    if (!found) return fail_('Товар не знайдено.');

    if (user.role !== 'admin') PRICE_FIELDS_.forEach(function (f) { delete payload[f]; });

    var idx = found.idx, rowNum = found.rowNum, sheet = found.sheet;
    Object.keys(PRODUCT_EDITABLE_FIELDS_).forEach(function (field) {
      if (payload[field] !== undefined) {
        sheet.getRange(rowNum, idx[PRODUCT_EDITABLE_FIELDS_[field]] + 1).setValue(payload[field]);
      }
    });
    sheet.getRange(rowNum, idx.UpdatedAt + 1).setValue(nowStr_());

    logHistory_(user, 'Редагування товару', found.row[idx.Article], found.row[idx.Name], 0, 'Оновлено картку');
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteProduct(token, productId) {
  try {
    var user = requireRole_(token, ['admin']); // лише адмін може видаляти
    var found = findProductRow_(productId);
    if (!found) return fail_('Товар не знайдено.');

    logHistory_(user, 'Видалення товару', found.row[found.idx.Article], found.row[found.idx.Name], 0, '');
    found.sheet.deleteRow(found.rowNum);
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Масове видалення кількох товарів одразу (для вибору чекбоксами у списку).
 */
function deleteProductsBulk(token, productIds) {
  try {
    var user = requireRole_(token, ['admin']);
    if (!productIds || !productIds.length) return fail_('Не обрано жодного товару.');

    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var idSet = {};
    productIds.forEach(function (id) { idSet[id] = true; });

    var deleted = 0;
    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      if (row[idx.ID] && idSet[row[idx.ID]]) {
        logHistory_(user, 'Видалення товару (масове)', row[idx.Article], row[idx.Name], 0, '');
        sheet.deleteRow(i + 1);
        deleted++;
      }
    }
    return ok_({ deleted: deleted });
  } catch (e) {
    return fail_(e.message);
  }
}
