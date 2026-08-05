/**
 * Labels.gs — друк етикеток з артикулами товарів.
 *
 * Замінює попередню функціональність QR-кодів: розпізнавання QR камерою
 * браузера виявилось ненадійним (архітектурне обмеження вбудованого
 * iframe Google Apps Script + обмеження веб-камери), тоді як друк і
 * читання звичайного тексту (артикул) працює завжди, без жодних збоїв.
 */

/**
 * Дані для сторінки масового друку етикеток (усі товари або обрані).
 */
function getQrPrintData(token, productIds) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var idSet = productIds && productIds.length ? {} : null;
    if (idSet) productIds.forEach(function (id) { idSet[id] = true; });

    var items = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      if (idSet && !idSet[row[idx.ID]]) continue;
      items.push({
        id: row[idx.ID],
        article: row[idx.Article],
        code: row[idx.Code],
        name: row[idx.Name],
        cell: row[idx.Cell]
      });
    }
    return ok_(items);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Пошук товару за артикулом (використовується для швидкого ручного пошуку).
 */
function findProductByArticle(token, article) {
  try {
    var user = requireAuth_(token);
    article = String(article || '').trim();
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idx.Article]).toLowerCase() === article.toLowerCase()) {
        return ok_(stripPriceIfNeeded_(rowToProduct_(data[i], idx), user));
      }
    }
    return fail_('Товар з таким артикулом не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}
