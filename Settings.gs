/**
 * Settings.gs — одиниці виміру, статистика, сповіщення про мінімальні залишки.
 */

/**
 * Ставка ПДВ (%) — використовується для обчислення "ціна з ПДВ" з базових цін.
 * Зберігається в аркуші Settings як звичайний рядок Key/Value.
 */
function getVatRate_() {
  var sheet = getDb_().getSheetByName(SHEET_SETTINGS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === 'VatRatePercent') return Number(data[i][1]) || 0;
  }
  return 20; // типове значення, якщо ще не збережено
}

function getVatRate(token) {
  try {
    requireAuth_(token);
    return ok_(getVatRate_());
  } catch (e) {
    return fail_(e.message);
  }
}

function setVatRate(token, percent) {
  try {
    requireRole_(token, ['admin']);
    percent = Number(percent);
    if (isNaN(percent) || percent < 0) return fail_('Вкажіть коректну ставку ПДВ.');

    var sheet = getDb_().getSheetByName(SHEET_SETTINGS);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === 'VatRatePercent') {
        sheet.getRange(i + 1, 2).setValue(percent);
        return ok_(true);
      }
    }
    sheet.appendRow(['VatRatePercent', percent]);
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Об'єднує дані, потрібні одразу при відкритті застосунку (одиниці виміру,
 * варіанти фільтрів, статистика дашборду) — в ОДИН виклик замість трьох
 * окремих. Кожен окремий виклик до Apps Script — це новий процес із
 * власним відкриттям таблиці (типово 1-3 сек), тому об'єднання суттєво
 * пришвидшує перше завантаження застосунку.
 */
function getBootstrapData(token) {
  try {
    var user = requireAuth_(token);

    var unitsResult = listUnits(token);
    var filterResult = getFilterOptions(token);
    var statsResult = getStats(token);

    return ok_({
      units: unitsResult.success ? unitsResult.data : [],
      filterOptions: filterResult.success ? filterResult.data : {},
      stats: statsResult.success ? statsResult.data : null,
      dashboardWidgets: getDashboardWidgetsConfig_()
    });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Список усіх можливих блоків дашборду — власник вирішує в Налаштуваннях,
 * які саме показувати. Зберігається в Settings як JSON-масив увімкнених ID
 * (ключ 'DashboardWidgets'). Якщо нічого не збережено — типово всі увімкнені.
 */
var DASHBOARD_WIDGET_IDS_ = [
  'statProducts', 'statCategories', 'statTotalQty', 'statLowStock',
  'statPlannedAssemblies', 'statCompletedAssemblies', 'statOverduePurchases', 'statPendingPurchases',
  'statNewCustomerOrders', 'statActiveCustomerOrders', 'statOverdueCustomerOrders', 'statActiveProductionOrders',
  'panelLowStock', 'panelMostUsed', 'panelPlannedAssemblies', 'panelRecentOps',
  'panelCustomerOrdersAttention', 'panelProductionStages', 'panelPurchaseOrdersAttention'
];

function getDashboardWidgetsConfig_() {
  var sheet = getDb_().getSheetByName(SHEET_SETTINGS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === 'DashboardWidgets') {
      try {
        var saved = JSON.parse(data[i][1]);
        if (Array.isArray(saved)) return saved.filter(function (w) { return DASHBOARD_WIDGET_IDS_.indexOf(w) !== -1; });
      } catch (e) { /* ігноруємо биту конфігурацію, повертаємо типову нижче */ }
    }
  }
  return DASHBOARD_WIDGET_IDS_.slice();
}

function getDashboardWidgetsConfig(token) {
  try {
    requireAuth_(token);
    return ok_(getDashboardWidgetsConfig_());
  } catch (e) {
    return fail_(e.message);
  }
}

function setDashboardWidgetsConfig(token, widgets) {
  try {
    requireRole_(token, ['admin']);
    if (!Array.isArray(widgets)) return fail_('Некоректний список блоків дашборду.');
    widgets = widgets.filter(function (w) { return DASHBOARD_WIDGET_IDS_.indexOf(w) !== -1; });

    var sheet = getDb_().getSheetByName(SHEET_SETTINGS);
    var data = sheet.getDataRange().getValues();
    var json = JSON.stringify(widgets);
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === 'DashboardWidgets') {
        sheet.getRange(i + 1, 2).setValue(json);
        return ok_(true);
      }
    }
    sheet.appendRow(['DashboardWidgets', json]);
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

function listUnits(token) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_UNITS);
    var data = sheet.getDataRange().getValues();
    var units = [];
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) units.push(data[i][0]);
    }
    return ok_(units);
  } catch (e) {
    return fail_(e.message);
  }
}

function addUnit(token, unitName) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    unitName = String(unitName || '').trim();
    if (!unitName) return fail_('Вкажіть назву одиниці.');

    var sheet = getDb_().getSheetByName(SHEET_UNITS);
    var existing = sheet.getDataRange().getValues().map(function (r) { return String(r[0]).toLowerCase(); });
    if (existing.indexOf(unitName.toLowerCase()) !== -1) return fail_('Така одиниця вже існує.');

    sheet.appendRow([unitName]);
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteUnit(token, unitName) {
  try {
    requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_UNITS);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === unitName) {
        sheet.deleteRow(i + 1);
        return ok_(true);
      }
    }
    return fail_('Одиницю не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Товари, у яких залишок нижче (або дорівнює) мінімального.
 */
function getLowStockProducts(token) {
  try {
    var user = requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var reserved = getReservedQtyMap_();
    var lowStock = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      var qty = Number(row[idx.Qty]) || 0;
      var minQty = Number(row[idx.MinQty]) || 0;
      var available = qty - (reserved[row[idx.ID]] || 0);
      if (minQty > 0 && available <= minQty) {
        var product = stripPriceIfNeeded_(rowToProduct_(row, idx), user);
        product.reservedQty = reserved[row[idx.ID]] || 0;
        product.availableQty = available;
        lowStock.push(product);
      }
    }
    return ok_(lowStock);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Загальна статистика для дашборду + товари, що закінчуються (з урахуванням
 * резервів під заплановані вироби) + зведення по виробництву — одним запитом.
 */
function getStats(token) {
  try {
    var user = requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var reserved = getReservedQtyMap_();

    var categories = {};
    var totalQty = 0;
    var lowStockCount = 0;
    var productCount = 0;
    var lowStock = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      productCount++;
      var qty = Number(row[idx.Qty]) || 0;
      var minQty = Number(row[idx.MinQty]) || 0;
      var available = qty - (reserved[row[idx.ID]] || 0);
      totalQty += qty;
      if (row[idx.Category]) categories[row[idx.Category]] = true;
      if (minQty > 0 && available <= minQty) {
        lowStockCount++;
        var product = stripPriceIfNeeded_(rowToProduct_(row, idx), user);
        product.availableQty = available;
        lowStock.push(product);
      }
    }

    var historyData = getHistoryDerivedData_(10);
    var mostUsed = historyData.mostUsed;
    var recentOps = historyData.recentOperations;
    var productionSummary = getProductionSummary_();
    var purchaseSummary = getPurchaseOrderSummary_();
    var customerOrderSummary = getCustomerOrderSummary_();
    var stageSummary = getProductionStageSummary_();

    return ok_({
      productCount: productCount,
      categoryCount: Object.keys(categories).length,
      totalQty: totalQty,
      lowStockCount: lowStockCount,
      lowStock: lowStock,
      plannedAssemblies: productionSummary.planned,
      completedAssemblies: productionSummary.completed,
      pendingPurchaseOrders: purchaseSummary.pending,
      overduePurchaseOrders: purchaseSummary.overdue,
      purchaseOrdersOrderedCount: purchaseSummary.orderedCount,
      purchaseOrdersPartialCount: purchaseSummary.partialCount,
      purchaseOrdersAttention: purchaseSummary.attention,
      mostUsed: mostUsed,
      recentOperations: recentOps,
      customerOrders: customerOrderSummary,
      productionStages: stageSummary
    });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Заявки постачальникам: скільки не завершено (не 'delivered'), скільки
 * прострочено за очікуваною датою поставки, розбивка по статусах +
 * короткий список тих, що потребують уваги (прострочені спершу).
 */
function getPurchaseOrderSummary_() {
  var sheet = getDb_().getSheetByName(SHEET_PURCHASE_ORDERS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  var pending = 0, overdue = 0, orderedCount = 0, partialCount = 0;
  var now = new Date();
  var attention = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[idx.ID] || row[idx.Status] === 'delivered') continue;
    pending++;
    if (row[idx.Status] === 'ordered') orderedCount++;
    if (row[idx.Status] === 'partial') partialCount++;
    var isOverdue = !!(row[idx.ExpectedDeliveryDate] && new Date(row[idx.ExpectedDeliveryDate]) < now);
    if (isOverdue) overdue++;
    attention.push({
      id: row[idx.ID],
      supplier: row[idx.Supplier],
      status: row[idx.Status],
      expectedDeliveryDate: row[idx.ExpectedDeliveryDate],
      isOverdue: isOverdue
    });
  }
  attention.sort(function (a, b) { return (b.isOverdue ? 1 : 0) - (a.isOverdue ? 1 : 0); });
  return { pending: pending, overdue: overdue, orderedCount: orderedCount, partialCount: partialCount, attention: attention.slice(0, 8) };
}

/**
 * Замовлення клієнтів: розбивка по статусах ('new', 'in_production',
 * 'completed', 'cancelled') + прострочені за дедлайном + короткий список
 * тих, що потребують уваги (нові ще не в роботі, або вже прострочені).
 */
function getCustomerOrderSummary_() {
  var sheet = getDb_().getSheetByName(SHEET_CUSTOMER_ORDERS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  var now = new Date();
  var counts = { 'new': 0, in_production: 0, completed: 0, cancelled: 0 };
  var overdueCount = 0;
  var attention = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[idx.ID]) continue;
    var status = row[idx.Status] || 'new';
    counts[status] = (counts[status] || 0) + 1;
    var isOverdue = status !== 'completed' && status !== 'cancelled' && row[idx.Deadline] && new Date(row[idx.Deadline]) < now;
    if (isOverdue) overdueCount++;
    if (status === 'new' || isOverdue) {
      attention.push({
        id: row[idx.ID], orderNumber: row[idx.OrderNumber], clientName: row[idx.ClientName],
        status: status, deadline: row[idx.Deadline], isOverdue: !!isOverdue, priority: row[idx.Priority]
      });
    }
  }
  attention.sort(function (a, b) { return (b.isOverdue ? 1 : 0) - (a.isOverdue ? 1 : 0); });
  return {
    newCount: counts['new'] || 0,
    inProductionCount: counts.in_production || 0,
    completedCount: counts.completed || 0,
    cancelledCount: counts.cancelled || 0,
    overdueCount: overdueCount,
    attention: attention.slice(0, 8)
  };
}

/**
 * Скільки виробничих замовлень зараз "у роботі" (in_progress) і на якому
 * саме етапі кожне знаходиться — щоб на дашборді було видно завантаженість
 * по кожному етапу виробництва, а не тільки загальну кількість.
 */
function getProductionStageSummary_() {
  var ss = getDb_();
  var stagesSheet = ss.getSheetByName(SHEET_PRODUCTION_STAGES);
  var stagesData = stagesSheet.getDataRange().getValues();
  var stagesIdx = indexMap_(stagesData[0]);
  var stageNames = stagesData.slice(1)
    .filter(function (r) { return r[stagesIdx.ID]; })
    .sort(function (a, b) { return (Number(a[stagesIdx.SortOrder]) || 0) - (Number(b[stagesIdx.SortOrder]) || 0); })
    .map(function (r) { return r[stagesIdx.Name]; });

  var counts = stageNames.map(function () { return 0; });
  var ordersSheet = ss.getSheetByName(SHEET_PRODUCTION_ORDERS);
  var ordersData = ordersSheet.getDataRange().getValues();
  var ordersIdx = indexMap_(ordersData[0]);
  var activeCount = 0;
  for (var i = 1; i < ordersData.length; i++) {
    var row = ordersData[i];
    if (!row[ordersIdx.ID] || row[ordersIdx.Status] !== 'in_progress') continue;
    activeCount++;
    var stageIdx = Number(row[ordersIdx.CurrentStageIndex]) || 0;
    if (counts[stageIdx] !== undefined) counts[stageIdx]++;
  }

  return {
    activeCount: activeCount,
    stages: stageNames.map(function (name, i) { return { name: name, count: counts[i] || 0 }; })
  };
}

function getHistoryDerivedData_(recentLimit) {
  var sheet = getDb_().getSheetByName(SHEET_HISTORY);
  var data = sheet.getDataRange().getValues();
  var headers = data.shift();
  var idx = indexMap_(headers);

  var counts = {};
  data.forEach(function (row) {
    if (row[idx.Action] === 'Прихід' || row[idx.Action] === 'Видача') {
      var key = row[idx.Article] + ' | ' + row[idx.Name];
      counts[key] = (counts[key] || 0) + Math.abs(Number(row[idx.Qty]) || 0);
    }
  });

  var mostUsed = Object.keys(counts)
    .map(function (key) {
      var parts = key.split(' | ');
      return { article: parts[0], name: parts[1], totalMoved: counts[key] };
    })
    .sort(function (a, b) { return b.totalMoved - a.totalMoved; })
    .slice(0, 5);

  var recentOperations = data.slice(-recentLimit).reverse().map(function (row) {
    return {
      timestamp: row[idx.Timestamp], user: row[idx.User], action: row[idx.Action],
      article: row[idx.Article], name: row[idx.Name], qty: row[idx.Qty]
    };
  });

  return { mostUsed: mostUsed, recentOperations: recentOperations };
}

function getRecentOperations_(limit) {
  var sheet = getDb_().getSheetByName(SHEET_HISTORY);
  var data = sheet.getDataRange().getValues();
  var headers = data.shift();
  var idx = indexMap_(headers);

  return data.reverse().slice(0, limit).map(function (row) {
    return {
      timestamp: row[idx.Timestamp],
      user: row[idx.User],
      action: row[idx.Action],
      article: row[idx.Article],
      name: row[idx.Name],
      qty: row[idx.Qty]
    };
  });
}

/**
 * Кількість запланованих (зарезервованих) і завершених замовлень на
 * виробництво — для дашборду.
 */
function getProductionSummary_() {
  var sheet = getDb_().getSheetByName(SHEET_PRODUCTION_ORDERS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);

  var planned = [], completed = 0;
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[idx.ID]) continue;
    if (row[idx.Status] === 'planned') {
      planned.push({ assemblyName: row[idx.AssemblyName], units: Number(row[idx.UnitsPlanned]) || 0 });
    } else if (row[idx.Status] === 'completed') {
      completed++;
    }
  }
  return { planned: planned, completed: completed };
}

/**
 * Створює резервну копію бази даних (копія Google Sheet) у Google Drive.
 */
function createBackup(token) {
  try {
    requireRole_(token, ['admin']);
    var ss = getDb_();
    var file = DriveApp.getFileById(ss.getId());
    var backupName = 'SHSklad_Backup_' + Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy-MM-dd_HHmmss');
    var copy = file.makeCopy(backupName);
    return ok_({ name: backupName, url: copy.getUrl() });
  } catch (e) {
    return fail_(e.message);
  }
}

function listBackups(token) {
  try {
    requireRole_(token, ['admin']);
    var files = DriveApp.searchFiles('title contains "SHSklad_Backup_"');
    var list = [];
    while (files.hasNext()) {
      var f = files.next();
      list.push({ name: f.getName(), url: f.getUrl(), date: f.getDateCreated() });
    }
    list.sort(function (a, b) { return b.date - a.date; });
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}
