/**
 * Warehouses.gs — віртуальні склади.
 *
 * Загальний залишок товару (Products.Qty) лишається єдиним джерелом істини
 * для всіх існуючих операцій (прихід/видача/коригування/вироби) — це НЕ
 * ламається і не переробляється. Віртуальні склади — це ДОДАТКОВИЙ розріз
 * "де саме в межах загального залишку лежить товар", який ведеться паралельно
 * (WarehouseStock: скільки з загального залишку приписано до кожного складу).
 */

function listWarehouses(token) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_WAREHOUSES);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var list = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][idx.ID]) continue;
      list.push({ id: data[i][idx.ID], name: data[i][idx.Name], isDefault: data[i][idx.IsDefault] === true });
    }
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

function createWarehouse(token, name) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    name = String(name || '').trim();
    if (!name) return fail_('Вкажіть назву складу.');
    var sheet = getDb_().getSheetByName(SHEET_WAREHOUSES);
    var id = newId_();
    sheet.appendRow([id, name, false, nowStr_()]);
    return ok_({ id: id });
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteWarehouse(token, warehouseId) {
  try {
    requireRole_(token, ['admin']);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_WAREHOUSES);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === warehouseId) {
        if (data[i][idx.IsDefault] === true) return fail_('Основний склад видалити не можна.');
        if (data.length <= 2) return fail_('Має лишитись хоча б один склад.');
        sheet.deleteRow(i + 1);
        found = true;
        break;
      }
    }
    if (!found) return fail_('Склад не знайдено.');

    // Прибираємо прив'язку залишків до видаленого складу (сам загальний
    // залишок товару при цьому НЕ змінюється — тільки розподіл по складах).
    var stockSheet = ss.getSheetByName(SHEET_WAREHOUSE_STOCK);
    var stockData = stockSheet.getDataRange().getValues();
    for (var j = stockData.length - 1; j >= 1; j--) {
      if (stockData[j][2] === warehouseId) stockSheet.deleteRow(j + 1);
    }
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Повний вміст конкретного складу: усі товари, яких там хоч трохи є.
 */
function getWarehouseContents(token, warehouseId) {
  try {
    requireAuth_(token);
    var ss = getDb_();
    var stockSheet = ss.getSheetByName(SHEET_WAREHOUSE_STOCK);
    var stockData = stockSheet.getDataRange().getValues();
    var stockIdx = indexMap_(stockData[0]);

    var warehousesSheet = ss.getSheetByName(SHEET_WAREHOUSES);
    var warehousesData = warehousesSheet.getDataRange().getValues();
    var warehousesIdx = indexMap_(warehousesData[0]);
    var isDefaultWarehouse = false;
    for (var w = 1; w < warehousesData.length; w++) {
      if (warehousesData[w][warehousesIdx.ID] === warehouseId && warehousesData[w][warehousesIdx.IsDefault] === true) {
        isDefaultWarehouse = true;
        break;
      }
    }

    var productsSheet = ss.getSheetByName(SHEET_PRODUCTS);
    var productsData = productsSheet.getDataRange().getValues();
    var productsIdx = indexMap_(productsData[0]);

    // Сума явних записів WarehouseStock по кожному товару й складу.
    var stockByProductAndWarehouse = {}; // productId -> { warehouseId -> qty }
    for (var i = 1; i < stockData.length; i++) {
      var row = stockData[i];
      var pid = row[stockIdx.ProductID];
      if (!stockByProductAndWarehouse[pid]) stockByProductAndWarehouse[pid] = {};
      stockByProductAndWarehouse[pid][row[stockIdx.WarehouseID]] =
        (stockByProductAndWarehouse[pid][row[stockIdx.WarehouseID]] || 0) + (Number(row[stockIdx.Qty]) || 0);
    }

    var items = [];
    for (var p = 1; p < productsData.length; p++) {
      var pRow = productsData[p];
      if (!pRow[productsIdx.ID]) continue;
      var totalQty = Number(pRow[productsIdx.Qty]) || 0;
      var byWh = stockByProductAndWarehouse[pRow[productsIdx.ID]] || {};

      var qtyHere;
      if (isDefaultWarehouse) {
        // Основний склад = загальний залишок МІНУС усе, що явно приписано до ІНШИХ складів,
        // ПЛЮС те, що, можливо, вже явно приписано до самого основного.
        var allocatedElsewhere = 0;
        Object.keys(byWh).forEach(function (whId) { if (whId !== warehouseId) allocatedElsewhere += byWh[whId]; });
        qtyHere = round2_(totalQty - allocatedElsewhere);
      } else {
        qtyHere = round2_(byWh[warehouseId] || 0);
      }

      if (Math.abs(qtyHere) < 0.0001) continue;
      items.push({
        productId: pRow[productsIdx.ID],
        article: pRow[productsIdx.Article],
        code: pRow[productsIdx.Code],
        name: pRow[productsIdx.Name],
        unit: pRow[productsIdx.Unit],
        photoUrl: pRow[productsIdx.PhotoUrl],
        qty: qtyHere
      });
    }
    items.sort(function (a, b) { return String(a.article || '').localeCompare(String(b.article || '')); });
    return ok_(items);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Розподіл залишку товару по складах. Усе, що не приписано явно до
 * конкретного (не основного) складу, автоматично належить ОСНОВНОМУ складу —
 * так само, як загальна вартість складу завжди дорівнює сумі по всіх складах.
 */
function getWarehouseBreakdown(token, productId) {
  try {
    requireAuth_(token);
    var ss = getDb_();
    var stockSheet = ss.getSheetByName(SHEET_WAREHOUSE_STOCK);
    var stockData = stockSheet.getDataRange().getValues();
    var stockIdx = indexMap_(stockData[0]);

    var warehousesSheet = ss.getSheetByName(SHEET_WAREHOUSES);
    var warehousesData = warehousesSheet.getDataRange().getValues();
    var warehousesIdx = indexMap_(warehousesData[0]);
    var namesById = {};
    var defaultWarehouseId = null;
    for (var w = 1; w < warehousesData.length; w++) {
      var whRow = warehousesData[w];
      namesById[whRow[warehousesIdx.ID]] = whRow[warehousesIdx.Name];
      if (whRow[warehousesIdx.IsDefault] === true) defaultWarehouseId = whRow[warehousesIdx.ID];
    }

    var byWarehouse = {};
    for (var i = 1; i < stockData.length; i++) {
      var row = stockData[i];
      if (row[stockIdx.ProductID] !== productId) continue;
      byWarehouse[row[stockIdx.WarehouseID]] = (byWarehouse[row[stockIdx.WarehouseID]] || 0) + (Number(row[stockIdx.Qty]) || 0);
    }

    var found = findProductRow_(productId);
    var totalQty = found ? Number(found.row[found.idx.Qty]) || 0 : 0;

    var allocatedToOthers = 0;
    Object.keys(byWarehouse).forEach(function (whId) { if (whId !== defaultWarehouseId) allocatedToOthers += byWarehouse[whId]; });

    // Все нерозподілене автоматично приписуємо до основного складу.
    if (defaultWarehouseId) {
      byWarehouse[defaultWarehouseId] = round2_(totalQty - allocatedToOthers);
    }

    var breakdown = Object.keys(byWarehouse)
      .filter(function (whId) { return Math.abs(byWarehouse[whId]) > 0.0001; })
      .map(function (whId) {
        return { warehouseId: whId, warehouseName: namesById[whId] || '(видалений склад)', qty: byWarehouse[whId] };
      });
    // Основний склад завжди показуємо першим.
    breakdown.sort(function (a, b) { return (a.warehouseId === defaultWarehouseId) ? -1 : (b.warehouseId === defaultWarehouseId ? 1 : 0); });

    return ok_({ totalQty: totalQty, breakdown: breakdown });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Внутрішній хелпер: змінити скільки товару приписано до конкретного складу
 * (не чіпає загальний Products.Qty — той міняється окремо, як і завжди).
 */
function adjustWarehouseStock_(productId, warehouseId, delta) {
  if (!warehouseId) return; // склад не вказано — просто не ведемо розподіл для цього руху
  var sheet = getDb_().getSheetByName(SHEET_WAREHOUSE_STOCK);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === productId && data[i][2] === warehouseId) {
      var newQty = (Number(data[i][3]) || 0) + delta;
      sheet.getRange(i + 1, 4).setValue(newQty);
      return;
    }
  }
  sheet.appendRow([newId_(), productId, warehouseId, delta]);
}
