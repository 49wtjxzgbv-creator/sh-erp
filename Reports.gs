/**
 * Reports.gs — звіти й аналітика.
 */

/**
 * Товари, залишок яких на межі або нижче мінімального — з готовою
 * пропозицією, скільки замовити (щоб вийти на подвійний мінімальний запас).
 */
function getReorderSuggestions(token) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var reserved = getReservedQtyMap_();

    var suggestions = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      var minQty = Number(row[idx.MinQty]) || 0;
      if (minQty <= 0) continue;
      var qty = Number(row[idx.Qty]) || 0;
      var available = qty - (reserved[row[idx.ID]] || 0);
      if (available > minQty) continue;

      var suggestedQty = Math.max(1, Math.ceil(minQty * 2 - available));
      suggestions.push({
        productId: row[idx.ID],
        article: row[idx.Article],
        name: row[idx.Name],
        qty: qty,
        availableQty: available,
        minQty: minQty,
        suggestedQty: suggestedQty
      });
    }
    suggestions.sort(function (a, b) { return (a.availableQty - a.minQty) - (b.availableQty - b.minQty); });
    return ok_(suggestions);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Загальна вартість складу — одразу у всіх 5 типах цін (лише admin).
 */
function getWarehouseValueReport(token) {
  try {
    var user = requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var priceFields = {
      localExclVat: 'LocalPriceExclVat',
      localInclVat: 'LocalPriceInclVat',
      germanExclVat: 'GermanPriceExclVat',
      germanInclVat: 'GermanPriceInclVat',
      sellPrice: 'SellPriceEUR'
    };
    var totals = { localExclVat: 0, localInclVat: 0, germanExclVat: 0, germanInclVat: 0, sellPrice: 0 };
    var byCategory = {}; // category -> {localExclVat, localInclVat, ...}

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      var qty = Number(row[idx.Qty]) || 0;
      var cat = row[idx.Category] || '(без категорії)';
      if (!byCategory[cat]) byCategory[cat] = { localExclVat: 0, localInclVat: 0, germanExclVat: 0, germanInclVat: 0, sellPrice: 0 };

      Object.keys(priceFields).forEach(function (key) {
        var price = Number(row[idx[priceFields[key]]]) || 0;
        var value = qty * price;
        totals[key] += value;
        byCategory[cat][key] += value;
      });
    }

    Object.keys(totals).forEach(function (k) { totals[k] = round2_(totals[k]); });
    var categoryBreakdown = Object.keys(byCategory).map(function (cat) {
      var v = byCategory[cat];
      Object.keys(v).forEach(function (k) { v[k] = round2_(v[k]); });
      v.category = cat;
      return v;
    }).sort(function (a, b) { return b.localExclVat - a.localExclVat; });

    return ok_({ totals: totals, categoryBreakdown: categoryBreakdown });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Виробництво по місяцях (останні 6 місяців): скільки замовлень завершено,
 * скільки одиниць виготовлено, загальна собівартість.
 */
function getProductionReport(token) {
  try {
    var user = requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTION_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var byMonth = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID] || row[idx.Status] !== 'completed' || !row[idx.CompletedAt]) continue;
      var monthKey = String(row[idx.CompletedAt]).slice(0, 7); // "yyyy-MM"
      if (!byMonth[monthKey]) byMonth[monthKey] = { month: monthKey, orders: 0, units: 0, costEur: 0 };
      byMonth[monthKey].orders++;
      byMonth[monthKey].units += Number(row[idx.UnitsPlanned]) || 0;
      if (user.role === 'admin') byMonth[monthKey].costEur += Number(row[idx.TotalLocalCostEur]) || 0;
    }

    var months = Object.keys(byMonth).sort().slice(-6).map(function (k) {
      var m = byMonth[k];
      m.costEur = round2_(m.costEur);
      return m;
    });
    return ok_(months);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Об'єднаний виклик для сторінки "Звіти" — одним запитом замість трьох.
 */
function getReportsData(token) {
  try {
    requireAuth_(token);
    var reorder = getReorderSuggestions(token);
    var production = getProductionReport(token);
    var warehouseValue = getWarehouseValueReport(token); // сам перевірить право admin і поверне fail_, якщо не можна

    return ok_({
      reorderSuggestions: reorder.success ? reorder.data : [],
      production: production.success ? production.data : [],
      warehouseValue: warehouseValue.success ? warehouseValue.data : null
    });
  } catch (e) {
    return fail_(e.message);
  }
}
