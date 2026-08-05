/**
 * Warehouse.gs — операції зі складом: прихід, видача, переміщення, коригування.
 * Кожна операція записується в History.gs.
 */

function receiveStock(token, productId, qty, comment, warehouseId) {
  var res = applyStockChange_(token, ['admin', 'storekeeper'], productId, Math.abs(Number(qty)), 'Прихід', comment);
  if (res.success && warehouseId) adjustWarehouseStock_(productId, warehouseId, Math.abs(Number(qty)));
  return res;
}

/**
 * Масовий прихід: приймає масив { article, qty, comment } — знаходить товар
 * за артикулом і одразу додає кількість до залишку. Використовується коли
 * приходить багато позицій одразу (накладна), щоб не відкривати кожен
 * товар окремо. rows можна ввести вручну в інтерфейсі або завантажити з Excel.
 */
function bulkReceiveStock(token, rows, warehouseId) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    if (!rows || !rows.length) return fail_('Немає рядків для обробки.');

    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var byArticle = {};
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.Article]) byArticle[String(data[i][idx.Article]).toLowerCase()] = i + 1; // номер рядка
    }

    var success = [], errors = [];

    rows.forEach(function (r, rowIndex) {
      var article = String(r.article || '').trim();
      var qty = Math.abs(Number(r.qty)) || 0;
      if (!article) { errors.push('Рядок ' + (rowIndex + 1) + ': відсутній артикул.'); return; }
      if (!qty) { errors.push('Рядок ' + (rowIndex + 1) + ' (' + article + '): відсутня або нульова кількість.'); return; }

      var rowNum = byArticle[article.toLowerCase()];
      if (!rowNum) { errors.push('Артикул "' + article + '" не знайдено на складі.'); return; }

      var freshRow = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
      var oldQty = Number(freshRow[idx.Qty]) || 0;
      var newQty = oldQty + qty;

      sheet.getRange(rowNum, idx.Qty + 1).setValue(newQty);
      sheet.getRange(rowNum, idx.UpdatedAt + 1).setValue(nowStr_());
      if (warehouseId) adjustWarehouseStock_(freshRow[idx.ID], warehouseId, qty);

      logHistory_(user, 'Прихід', article, freshRow[idx.Name], qty, (r.comment || '') + ' (масовий прихід)');
      success.push({ article: article, name: freshRow[idx.Name], addedQty: qty, newQty: newQty });
    });

    return ok_({ success: success, errors: errors });
  } catch (e) {
    return fail_(e.message);
  }
}

function issueStock(token, productId, qty, comment, warehouseId) {
  var res = applyStockChange_(token, ['admin', 'storekeeper'], productId, -Math.abs(Number(qty)), 'Видача', comment);
  if (res.success && warehouseId) adjustWarehouseStock_(productId, warehouseId, -Math.abs(Number(qty)));
  return res;
}

/**
 * Списання браку/пошкодженого товару — окремо від звичайної видачі, щоб в
 * історії було чітко видно, що це втрата, а не нормальний рух товару.
 * Причина (comment) обов'язкова.
 */
function writeOffDefect(token, productId, qty, comment, warehouseId) {
  if (!comment || !String(comment).trim()) return fail_('Вкажіть причину списання браку.');
  var res = applyStockChange_(token, ['admin', 'storekeeper'], productId, -Math.abs(Number(qty)), 'Списання браку', comment);
  if (res.success && warehouseId) adjustWarehouseStock_(productId, warehouseId, -Math.abs(Number(qty)));
  return res;
}

function adjustStock(token, productId, newQty, comment) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var found = findProductRow_(productId);
    if (!found) return fail_('Товар не знайдено.');

    var idx = found.idx, rowNum = found.rowNum, sheet = found.sheet;
    var oldQty = Number(found.row[idx.Qty]) || 0;
    var delta = Number(newQty) - oldQty;

    sheet.getRange(rowNum, idx.Qty + 1).setValue(Number(newQty));
    sheet.getRange(rowNum, idx.UpdatedAt + 1).setValue(nowStr_());

    logHistory_(user, 'Коригування', found.row[idx.Article], found.row[idx.Name], delta,
      comment || ('Було: ' + oldQty + ', стало: ' + newQty));

    return ok_({ qty: Number(newQty) });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Переміщення товару між комірками (не змінює кількість, лише поле Cell).
 */
function moveStock(token, productId, newCell, comment) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var found = findProductRow_(productId);
    if (!found) return fail_('Товар не знайдено.');

    var idx = found.idx, rowNum = found.rowNum, sheet = found.sheet;
    var oldCell = found.row[idx.Cell];

    sheet.getRange(rowNum, idx.Cell + 1).setValue(newCell);
    sheet.getRange(rowNum, idx.UpdatedAt + 1).setValue(nowStr_());

    logHistory_(user, 'Переміщення', found.row[idx.Article], found.row[idx.Name], 0,
      comment || ('З комірки "' + oldCell + '" в комірку "' + newCell + '"'));

    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

function applyStockChange_(token, allowedRoles, productId, delta, actionLabel, comment) {
  try {
    var user = requireRole_(token, allowedRoles);
    var found = findProductRow_(productId);
    if (!found) return fail_('Товар не знайдено.');

    var idx = found.idx, rowNum = found.rowNum, sheet = found.sheet;
    var oldQty = Number(found.row[idx.Qty]) || 0;
    var newQty = oldQty + delta;
    if (newQty < 0) return fail_('Недостатньо залишку для видачі (наявно: ' + oldQty + ').');

    sheet.getRange(rowNum, idx.Qty + 1).setValue(newQty);
    sheet.getRange(rowNum, idx.UpdatedAt + 1).setValue(nowStr_());

    logHistory_(user, actionLabel, found.row[idx.Article], found.row[idx.Name], delta, comment || '');

    return ok_({ qty: newQty });
  } catch (e) {
    return fail_(e.message);
  }
}
