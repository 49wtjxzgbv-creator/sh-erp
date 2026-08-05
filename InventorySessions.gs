/**
 * InventorySessions.gs — інвентаризація.
 *
 * Створюєте сесію → система робить "знімок" поточних залишків усіх товарів →
 * ви проходите складом і вписуєте фактично порахована кількість → при
 * завершенні різниця автоматично коригується на складі (як звичайне
 * коригування, з повною історією), і формується акт розбіжностей.
 */

function createInventorySession(token, name, comment) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var ss = getDb_();

    var productsSheet = ss.getSheetByName(SHEET_PRODUCTS);
    var productsData = productsSheet.getDataRange().getValues();
    var productsIdx = indexMap_(productsData[0]);

    var id = newId_();
    var sessSheet = ss.getSheetByName(SHEET_INVENTORY_SESSIONS);
    sessSheet.appendRow([id, name || ('Інвентаризація ' + nowStr_()), 'in_progress', user.fullName || user.login, nowStr_(), '', comment || '']);

    var itemsSheet = ss.getSheetByName(SHEET_INVENTORY_ITEMS);
    var rows = [];
    for (var i = 1; i < productsData.length; i++) {
      var row = productsData[i];
      if (!row[productsIdx.ID]) continue;
      rows.push([
        newId_(), id, row[productsIdx.ID], row[productsIdx.Article], row[productsIdx.Name],
        Number(row[productsIdx.Qty]) || 0, '', false
      ]);
    }
    if (rows.length) {
      itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    logHistory_(user, 'Інвентаризація розпочата', '', name || '', rows.length, '');
    return ok_({ id: id, itemCount: rows.length });
  } catch (e) {
    return fail_(e.message);
  }
}

function listInventorySessions(token) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_INVENTORY_SESSIONS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var list = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      list.push({
        id: row[idx.ID], name: row[idx.Name], status: row[idx.Status],
        startedBy: row[idx.StartedBy], startedAt: row[idx.StartedAt],
        completedAt: row[idx.CompletedAt], comment: row[idx.Comment]
      });
    }
    list.reverse();
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

function getInventorySession(token, sessionId) {
  try {
    requireAuth_(token);
    var ss = getDb_();
    var sessSheet = ss.getSheetByName(SHEET_INVENTORY_SESSIONS);
    var sessData = sessSheet.getDataRange().getValues();
    var sessIdx = indexMap_(sessData[0]);
    var session = null;
    for (var i = 1; i < sessData.length; i++) {
      if (sessData[i][sessIdx.ID] === sessionId) { session = sessData[i]; break; }
    }
    if (!session) return fail_('Інвентаризацію не знайдено.');

    var itemsSheet = ss.getSheetByName(SHEET_INVENTORY_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsIdx = indexMap_(itemsData[0]);
    var items = [];
    for (var j = 1; j < itemsData.length; j++) {
      var row = itemsData[j];
      if (row[itemsIdx.InventorySessionID] !== sessionId) continue;
      var expected = Number(row[itemsIdx.ExpectedQty]) || 0;
      var counted = row[itemsIdx.Counted] === true;
      var actual = counted ? (Number(row[itemsIdx.ActualQty]) || 0) : null;
      items.push({
        id: row[itemsIdx.ID], productId: row[itemsIdx.ProductID],
        article: row[itemsIdx.Article], productName: row[itemsIdx.ProductName],
        expectedQty: expected, actualQty: actual, counted: counted,
        difference: counted ? round2_(actual - expected) : null
      });
    }
    items.sort(function (a, b) { return String(a.article || '').localeCompare(String(b.article || '')); });

    return ok_({
      id: session[sessIdx.ID], name: session[sessIdx.Name], status: session[sessIdx.Status],
      startedBy: session[sessIdx.StartedBy], startedAt: session[sessIdx.StartedAt],
      completedAt: session[sessIdx.CompletedAt], comment: session[sessIdx.Comment], items: items
    });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Записує фактично пораховану кількість по одній позиції.
 */
function setInventoryItemActual(token, itemId, actualQty) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    var sheet = getDb_().getSheetByName(SHEET_INVENTORY_ITEMS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === itemId) {
        sheet.getRange(i + 1, idx.ActualQty + 1).setValue(Number(actualQty) || 0);
        sheet.getRange(i + 1, idx.Counted + 1).setValue(true);
        return ok_(true);
      }
    }
    return fail_('Позицію не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Завершує інвентаризацію: для кожної порахованої позиції з розбіжністю —
 * автоматично коригує залишок на складі (звичайне коригування, з історією).
 * Непораховані позиції лишаються без змін.
 */
function completeInventorySession(token, sessionId) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var ss = getDb_();
    var itemsSheet = ss.getSheetByName(SHEET_INVENTORY_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsIdx = indexMap_(itemsData[0]);

    var adjusted = 0, unchanged = 0, uncounted = 0;
    for (var i = 1; i < itemsData.length; i++) {
      var row = itemsData[i];
      if (row[itemsIdx.InventorySessionID] !== sessionId) continue;
      if (row[itemsIdx.Counted] !== true) { uncounted++; continue; }

      var expected = Number(row[itemsIdx.ExpectedQty]) || 0;
      var actual = Number(row[itemsIdx.ActualQty]) || 0;
      if (Math.abs(actual - expected) < 0.0001) { unchanged++; continue; }

      var res = adjustStock(token, row[itemsIdx.ProductID], actual,
        'Інвентаризація: ' + row[itemsIdx.Article] + ' (' + expected + ' → ' + actual + ')');
      if (res.success) adjusted++;
    }

    var sessSheet = ss.getSheetByName(SHEET_INVENTORY_SESSIONS);
    var sessData = sessSheet.getDataRange().getValues();
    var sessIdx = indexMap_(sessData[0]);
    for (var j = 1; j < sessData.length; j++) {
      if (sessData[j][sessIdx.ID] === sessionId) {
        sessSheet.getRange(j + 1, sessIdx.Status + 1).setValue('completed');
        sessSheet.getRange(j + 1, sessIdx.CompletedAt + 1).setValue(nowStr_());
        break;
      }
    }

    logHistory_(user, 'Інвентаризація завершена', '', '', adjusted, 'Скориговано: ' + adjusted + ', без змін: ' + unchanged + ', не пораховано: ' + uncounted);
    return ok_({ adjusted: adjusted, unchanged: unchanged, uncounted: uncounted });
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteInventorySession(token, sessionId) {
  try {
    requireRole_(token, ['admin']);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_INVENTORY_SESSIONS);
    var data = sheet.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === sessionId) { sheet.deleteRow(i + 1); found = true; break; }
    }
    if (!found) return fail_('Не знайдено.');

    var itemsSheet = ss.getSheetByName(SHEET_INVENTORY_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    for (var j = itemsData.length - 1; j >= 1; j--) {
      if (itemsData[j][1] === sessionId) itemsSheet.deleteRow(j + 1);
    }
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}
