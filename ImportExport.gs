/**
 * ImportExport.gs — імпорт/експорт Excel для повного товарного довідника.
 *
 * "Розумний" імпорт: заголовки колонок у файлі користувача можуть бути
 * названі як завгодно (укр./рос./англ., з великої літери, зі скороченнями) —
 * сервер сам визначає, яка колонка відповідає якому полю, за словником
 * синонімів нижче. Розпізнавання вбудованих у файл зображень — на клієнті
 * (app.js), сюди вони приходять вже як base64 у полі _photoBase64.
 */

var EXPORT_HEADERS = [
  'Код', 'Артикул', 'Назва', 'Опис',
  'Категорія', 'Товарна група', 'Сімейство', 'Тип', 'Вид', 'Виріб', 'Штрих-код',
  'Одиниця', 'К-сть в упаковці', 'Місце зберігання', 'Залишок', 'К-сть в упаковках', 'Мін.залишок',
  'Ціна наша без ПДВ (EUR)', 'Ціна наша з ПДВ (EUR)', 'Ціна німецька без ПДВ (EUR)', 'Ціна німецька з ПДВ (EUR)', 'Ціна продажу (EUR)',
  'Вага за од. (кг)', 'Вага в наявності (кг)', 'Термін гарантії', 'Статус',
  'Виробник', 'Код виробника', 'Країна виробника',
  'Прайс-лист', 'Примітка', 'Фото URL'
];

/**
 * Словник синонімів заголовків -> внутрішнє поле товару.
 * Ключі порівнюються в нормалізованому вигляді (див. normalizeHeader_).
 * ВАЖЛИВО: довші/специфічніші фрази йдуть РАНІШЕ коротших в межах одного поля,
 * бо перше знайдене співпадіння виграє (напр. "ціна наша з пдв" має
 * розпізнатись раніше за просте "ціна наша").
 */
var FIELD_SYNONYMS = {
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
  photoUrl: ['фото url', 'photo url', 'фото', 'photo', 'зображення', 'image url', 'image', 'посилання на фото']
};

var FIELD_ORDER_ = Object.keys(FIELD_SYNONYMS); // порядок визначає пріоритет при неоднозначності

function normalizeHeader_(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/["'’]/g, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Визначає відповідність "заголовок файлу -> внутрішнє поле" один раз для всього імпорту.
 * Для кожного заголовка обирається НАЙДОВШИЙ співпадаючий синонім (щоб не переплутати
 * "ціна наша" з "ціна наша з пдв", коли обидва можуть частково збігатись).
 */
function buildHeaderMap_(rawHeaders) {
  var map = {};
  rawHeaders.forEach(function (raw) {
    // Службові поля, які клієнт додає сам (_photoBase64, _photoMimeType для
    // вбудованих фото) — це НЕ колонки з файлу користувача, їх не можна
    // намагатись розпізнати як звичайний стовпець (саме тут була причина
    // того, що в поле фото потрапляв текст "image/jpeg" замість посилання).
    if (String(raw).indexOf('_') === 0) return;

    var norm = normalizeHeader_(raw);
    var bestField = null, bestLen = -1;

    FIELD_ORDER_.forEach(function (field) {
      FIELD_SYNONYMS[field].forEach(function (syn) {
        if ((norm === syn || norm.indexOf(syn) !== -1) && syn.length > bestLen) {
          bestField = field;
          bestLen = syn.length;
        }
      });
    });

    if (bestField) map[raw] = bestField;
  });
  return map;
}

var NUMERIC_FIELDS_ = ['qty', 'minQty', 'unitsPerPackage', 'localPriceExclVat', 'localPriceInclVat', 'germanPriceExclVat', 'germanPriceInclVat', 'sellPriceEur', 'weightPerUnitKg'];

function mapRowToProduct_(row, headerMap) {
  var out = {};
  Object.keys(row).forEach(function (rawHeader) {
    var field = headerMap[rawHeader];
    if (!field) return;
    var value = row[rawHeader];
    if (NUMERIC_FIELDS_.indexOf(field) !== -1) {
      value = parseFloat(String(value).replace(',', '.').replace(/[^\d.\-]/g, '')) || 0;
    } else {
      value = String(value == null ? '' : value).trim();
    }
    out[field] = value;
  });
  return out;
}

/**
 * Імпорт масиву товарів (з розібраного клієнтом Excel-файлу).
 * rows — масив об'єктів "заголовок як у файлі -> значення" (SheetJS sheet_to_json),
 * кожен рядок може додатково містити _photoBase64/_photoMimeType (вбудоване фото).
 * Товари з існуючим артикулом — оновлюються, нові — додаються.
 */
function importProducts(token, rows) {
  try {
    var user = requireRole_(token, ['admin']); // імпорт лише для адміна
    if (!rows || !rows.length) return fail_('Файл порожній.');

    var headerMap = buildHeaderMap_(Object.keys(rows[0]));
    var mappedFields = Object.keys(headerMap).map(function (k) { return headerMap[k]; });
    if (mappedFields.indexOf('article') === -1 || mappedFields.indexOf('name') === -1) {
      return fail_('У файлі не знайдено колонок "Артикул" та/або "Назва" (перевірте написання заголовків).');
    }

    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var existingByArticle = {};
    for (var i = 1; i < data.length; i++) {
      existingByArticle[String(data[i][idx.Article]).toLowerCase()] = i + 1;
    }

    var created = 0, updated = 0, errors = [];

    rows.forEach(function (rawRow, rowIndex) {
      // Повністю порожній рядок (напр. розділювач між секціями таблиці) —
      // це не помилка, а звичайна структура файлу, просто пропускаємо мовчки.
      var isEntirelyBlank = Object.keys(rawRow).every(function (k) { return String(rawRow[k] || '').trim() === ''; });
      if (isEntirelyBlank) return;

      var r = mapRowToProduct_(rawRow, headerMap);
      var article = String(r.article || '').trim();
      var name = String(r.name || '').trim();
      if (!article || !name) {
        errors.push('Рядок ' + (rowIndex + 2) + ': відсутній артикул або назва.');
        return;
      }

      var photoUrl = r.photoUrl || '';
      if (rawRow._photoBase64) {
        try {
          var folder = getPhotosFolder_();
          var bytes = Utilities.base64Decode(rawRow._photoBase64);
          var blob = Utilities.newBlob(bytes, rawRow._photoMimeType || 'image/jpeg', article + '.jpg');
          var file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          photoUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
        } catch (photoErr) {
          errors.push('Рядок ' + (rowIndex + 2) + ': не вдалося завантажити фото (' + photoErr.message + ').');
        }
      }

      var existingRowNum = existingByArticle[article.toLowerCase()];
      var now = nowStr_();

      if (existingRowNum) {
        Object.keys(PRODUCT_EDITABLE_FIELDS_).forEach(function (field) {
          if (r[field] !== undefined) sheet.getRange(existingRowNum, idx[PRODUCT_EDITABLE_FIELDS_[field]] + 1).setValue(r[field]);
        });
        if (r.qty !== undefined) sheet.getRange(existingRowNum, idx.Qty + 1).setValue(r.qty);
        if (photoUrl) sheet.getRange(existingRowNum, idx.PhotoUrl + 1).setValue(photoUrl);
        sheet.getRange(existingRowNum, idx.UpdatedAt + 1).setValue(now);
        updated++;
      } else {
        var id = newId_();
        var newRow = new Array(Object.keys(idx).length).fill('');
        newRow[idx.ID] = id;
        newRow[idx.CreatedAt] = now;
        newRow[idx.UpdatedAt] = now;
        Object.keys(PRODUCT_EDITABLE_FIELDS_).forEach(function (field) {
          if (r[field] !== undefined) newRow[idx[PRODUCT_EDITABLE_FIELDS_[field]]] = r[field];
        });
        newRow[idx.Qty] = Number(r.qty) || 0;
        newRow[idx.PhotoUrl] = photoUrl; // застосовуємо ОСТАННІМ — остаточне значення завжди перемагає
        sheet.appendRow(newRow);
        created++;
      }
    });

    logHistory_(user, 'Імпорт Excel', '', '', 0, created + ' нових, ' + updated + ' оновлено');
    return ok_({ created: created, updated: updated, errors: errors });
  } catch (e) {
    return fail_(e.message);
  }
}

function previewImportColumns(token, sampleHeaders) {
  try {
    requireRole_(token, ['admin']);
    var headerMap = buildHeaderMap_(sampleHeaders);
    return ok_(sampleHeaders.map(function (h) { return { header: h, recognizedAs: headerMap[h] || null }; }));
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Експорт: повертає масив рядків для генерації .xlsx на клієнті (SheetJS).
 * Ціни (і похідні "з ПДВ") приховані для не-адмінів.
 */
function exportProducts(token) {
  try {
    var user = requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var rows = [EXPORT_HEADERS];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;

      var qty = Number(row[idx.Qty]) || 0;
      var unitsPerPackage = Number(row[idx.UnitsPerPackage]) || 0;
      var weightPerUnit = Number(row[idx.WeightPerUnitKg]) || 0;
      var isAdmin = user.role === 'admin';

      rows.push([
        row[idx.Code], row[idx.Article], row[idx.Name], row[idx.Description],
        row[idx.Category], row[idx.ProductGroup], row[idx.Family], row[idx.Type], row[idx.Kind],
        row[idx.ProductLine], row[idx.Barcode],
        row[idx.Unit], unitsPerPackage || '', row[idx.Cell], qty,
        unitsPerPackage > 0 ? Math.round((qty / unitsPerPackage) * 100) / 100 : '',
        row[idx.MinQty],
        isAdmin ? row[idx.LocalPriceExclVat] : '', isAdmin ? row[idx.LocalPriceInclVat] : '',
        isAdmin ? row[idx.GermanPriceExclVat] : '', isAdmin ? row[idx.GermanPriceInclVat] : '',
        isAdmin ? row[idx.SellPriceEUR] : '',
        weightPerUnit || '', weightPerUnit > 0 ? Math.round(weightPerUnit * qty * 100) / 100 : '',
        row[idx.WarrantyMonths], row[idx.Status],
        row[idx.Manufacturer], row[idx.ManufacturerCode], row[idx.CountryOfOrigin],
        row[idx.PriceListRef], row[idx.Note], row[idx.PhotoUrl]
      ]);
    }
    return ok_(rows);
  } catch (e) {
    return fail_(e.message);
  }
}
