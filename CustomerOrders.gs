/**
 * CustomerOrders.gs — замовлення клієнтів.
 *
 * Клієнт замовляє один або кілька виробів у певній кількості. Із такого
 * замовлення одним натисканням створюються всі потрібні виробничі замовлення
 * (ті самі "Дано в роботу", що вже є) — система сама резервує компоненти під
 * кожен виріб і повідомляє, якщо чогось не вистачає.
 */

function listCustomerOrders(token, statusFilter) {
  try {
    requireAuth_(token);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_CUSTOMER_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var itemsSheet = ss.getSheetByName(SHEET_CUSTOMER_ORDER_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsIdx = indexMap_(itemsData[0]);
    var itemCounts = {};
    for (var j = 1; j < itemsData.length; j++) {
      var coId = itemsData[j][itemsIdx.CustomerOrderID];
      if (!coId) continue;
      itemCounts[coId] = (itemCounts[coId] || 0) + 1;
    }

    var list = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      if (statusFilter && row[idx.Status] !== statusFilter) continue;
      list.push({
        id: row[idx.ID],
        orderNumber: row[idx.OrderNumber],
        clientName: row[idx.ClientName],
        contactPerson: row[idx.ContactPerson],
        deadline: row[idx.Deadline],
        priority: row[idx.Priority],
        status: row[idx.Status],
        documentFileUrl: row[idx.DocumentFileUrl],
        documentFileName: row[idx.DocumentFileName],
        comment: row[idx.Comment],
        itemCount: itemCounts[row[idx.ID]] || 0,
        isOverdue: row[idx.Status] !== 'completed' && row[idx.Status] !== 'cancelled' && row[idx.Deadline] &&
          new Date(row[idx.Deadline]) < new Date()
      });
    }
    list.reverse();
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

function getCustomerOrder(token, orderId) {
  try {
    var user = requireAuth_(token);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_CUSTOMER_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var orderRow = null;
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === orderId) { orderRow = data[i]; break; }
    }
    if (!orderRow) return fail_('Замовлення не знайдено.');

    var itemsSheet = ss.getSheetByName(SHEET_CUSTOMER_ORDER_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsIdx = indexMap_(itemsData[0]);

    var prodSheet = ss.getSheetByName(SHEET_PRODUCTION_ORDERS);
    var prodData = prodSheet.getDataRange().getValues();
    var prodIdx = indexMap_(prodData[0]);
    var prodStatusById = {};
    var prodStageIdxById = {};
    for (var pr = 1; pr < prodData.length; pr++) {
      if (prodData[pr][prodIdx.ID]) {
        prodStatusById[prodData[pr][prodIdx.ID]] = prodData[pr][prodIdx.Status];
        prodStageIdxById[prodData[pr][prodIdx.ID]] = Number(prodData[pr][prodIdx.CurrentStageIndex]) || 0;
      }
    }
    var stagesSheet = ss.getSheetByName(SHEET_PRODUCTION_STAGES);
    var stagesData = stagesSheet.getDataRange().getValues();
    var stagesIdx = indexMap_(stagesData[0]);
    var stageNames = stagesData.slice(1)
      .filter(function (r) { return r[stagesIdx.ID]; })
      .sort(function (a, b) { return (Number(a[stagesIdx.SortOrder]) || 0) - (Number(b[stagesIdx.SortOrder]) || 0); })
      .map(function (r) { return r[stagesIdx.Name]; });

    var asmSheet2 = ss.getSheetByName(SHEET_ASSEMBLIES);
    var asmData2 = asmSheet2.getDataRange().getValues();
    var asmIdx2 = indexMap_(asmData2[0]);
    var asmInfoById = {};
    for (var a2 = 1; a2 < asmData2.length; a2++) {
      if (asmData2[a2][asmIdx2.ID]) asmInfoById[asmData2[a2][asmIdx2.ID]] = { article: asmData2[a2][asmIdx2.Article] || '', photoUrl: asmData2[a2][asmIdx2.PhotoUrl] || '' };
    }

    var items = [];
    for (var j = 1; j < itemsData.length; j++) {
      var row = itemsData[j];
      if (row[itemsIdx.CustomerOrderID] !== orderId) continue;
      var prodId = row[itemsIdx.ProductionOrderID];
      var asmInfo = asmInfoById[row[itemsIdx.AssemblyID]] || { article: '', photoUrl: '' };
      items.push({
        id: row[itemsIdx.ID],
        assemblyId: row[itemsIdx.AssemblyID],
        assemblyName: row[itemsIdx.AssemblyName],
        article: asmInfo.article,
        photoUrl: asmInfo.photoUrl,
        qty: Number(row[itemsIdx.Qty]) || 0,
        productionOrderId: prodId || '',
        productionOrderStatus: prodId ? (prodStatusById[prodId] || '(видалено)') : '',
        stageName: prodId && prodStageIdxById[prodId] < stageNames.length ? (stageNames[prodStageIdxById[prodId]] || '') : ''
      });
    }

    var totalCostLocal = 0;
    var actualCostLocal = 0;
    var completedQty = 0, totalQty = 0;
    if (user.role === 'admin') {
      var fgAvailability = getFinishedGoodsAvailability_();
      var prodFullCostById = {};
      for (var pr2 = 1; pr2 < prodData.length; pr2++) {
        if (prodData[pr2][prodIdx.ID]) prodFullCostById[prodData[pr2][prodIdx.ID]] = Number(prodData[pr2][prodIdx.FullCostEur]) || 0;
      }
      items.forEach(function (it) {
        var comps = getAssemblyComponents_(it.assemblyId, fgAvailability);
        var cost = calcAssemblyCost_(comps, null, fgAvailability);
        it.unitCostLocal = cost.local;
        it.lineTotalLocal = round2_(cost.local * it.qty);
        totalCostLocal += it.lineTotalLocal;
        totalQty += it.qty;

        if (it.productionOrderStatus === 'completed' || it.productionOrderStatus === 'in_progress') {
          completedQty += it.qty;
          actualCostLocal += prodFullCostById[it.productionOrderId] || it.lineTotalLocal;
        }
      });

      // + фактичні витрати на закупівлю по заявках постачальникам, сформованих із цього замовлення
      var poSheet = ss.getSheetByName(SHEET_PURCHASE_ORDERS);
      var poData = poSheet.getDataRange().getValues();
      var poIdx = indexMap_(poData[0]);
      var relatedPoIds = {};
      for (var po = 1; po < poData.length; po++) {
        if (poData[po][poIdx.SourceCustomerOrderID] === orderId) relatedPoIds[poData[po][poIdx.ID]] = true;
      }
      if (Object.keys(relatedPoIds).length) {
        var poItemsSheet = ss.getSheetByName(SHEET_PURCHASE_ORDER_ITEMS);
        var poItemsData = poItemsSheet.getDataRange().getValues();
        var poItemsIdx = indexMap_(poItemsData[0]);
        for (var pi = 1; pi < poItemsData.length; pi++) {
          if (!relatedPoIds[poItemsData[pi][poItemsIdx.PurchaseOrderID]]) continue;
          var qtyReceived = Number(poItemsData[pi][poItemsIdx.QtyReceived]) || 0;
          if (!qtyReceived) continue;
          var actualP = poItemsData[pi][poItemsIdx.ActualPrice] !== '' ? Number(poItemsData[pi][poItemsIdx.ActualPrice]) : Number(poItemsData[pi][poItemsIdx.ExpectedPrice]) || 0;
          actualCostLocal += actualP * qtyReceived;
        }
      }
    }

    var percentComplete = totalQty > 0 ? Math.round((completedQty / totalQty) * 100) : 0;

    return ok_({
      id: orderRow[idx.ID],
      orderNumber: orderRow[idx.OrderNumber],
      clientName: orderRow[idx.ClientName],
      contactPerson: orderRow[idx.ContactPerson],
      deadline: orderRow[idx.Deadline],
      priority: orderRow[idx.Priority],
      status: orderRow[idx.Status],
      percentComplete: percentComplete,
      actualCostLocal: user.role === 'admin' ? round2_(actualCostLocal) : null,
      documentFileUrl: orderRow[idx.DocumentFileUrl],
      documentFileName: orderRow[idx.DocumentFileName],
      comment: orderRow[idx.Comment],
      totalCostLocal: user.role === 'admin' ? round2_(totalCostLocal) : null,
      items: items
    });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * payload = { orderNumber, clientName, contactPerson, deadline, priority, comment,
 *   items: [{assemblyId, qty}, ...],
 *   documentBase64, documentMimeType, documentFileName }
 */
function createCustomerOrder(token, payload) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    if (!payload.clientName) return fail_('Вкажіть клієнта.');
    if (!payload.items || !payload.items.length) return fail_('Додайте хоча б один виріб.');

    var ss = getDb_();
    var asmSheet = ss.getSheetByName(SHEET_ASSEMBLIES);
    var asmData = asmSheet.getDataRange().getValues();
    var asmIdx = indexMap_(asmData[0]);
    var namesById = {};
    for (var a = 1; a < asmData.length; a++) {
      if (asmData[a][asmIdx.ID]) namesById[asmData[a][asmIdx.ID]] = asmData[a][asmIdx.Name];
    }

    var docUrl = '', docFileName = '';
    if (payload.documentBase64) {
      try {
        var folder = getCustomerDocsFolder_();
        var bytes = Utilities.base64Decode(payload.documentBase64);
        var fileName = payload.documentFileName || 'document.pdf';
        var blob = Utilities.newBlob(bytes, payload.documentMimeType || 'application/pdf', fileName);
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        docUrl = file.getUrl();
        docFileName = fileName;
      } catch (fileErr) { /* не блокуємо створення замовлення через збій завантаження файлу */ }
    }

    var id = newId_();
    var sheet = ss.getSheetByName(SHEET_CUSTOMER_ORDERS);
    sheet.appendRow([
      id, payload.orderNumber || '', payload.clientName, payload.contactPerson || '',
      payload.deadline || '', payload.priority || 'normal', 'new',
      docUrl, docFileName, payload.comment || '', user.fullName || user.login, nowStr_()
    ]);

    var itemsSheet = ss.getSheetByName(SHEET_CUSTOMER_ORDER_ITEMS);
    payload.items.forEach(function (it) {
      var qty = Number(it.qty) || 0;
      if (!it.assemblyId || !qty) return;
      itemsSheet.appendRow([newId_(), id, it.assemblyId, namesById[it.assemblyId] || '(виріб видалено)', qty, '']);
    });

    logHistory_(user, 'Замовлення клієнта створено', '', payload.clientName, 0,
      (payload.orderNumber ? '№ ' + payload.orderNumber : '') + ', позицій: ' + payload.items.length);

    try {
      tgNotifyAdmins_('🧾 Нове замовлення клієнта' + (payload.orderNumber ? ' №' + payload.orderNumber : '') +
        '\nКлієнт: ' + payload.clientName + '\nПозицій: ' + payload.items.length);
    } catch (tgErr) { /* сповіщення не повинно блокувати створення замовлення */ }

    return ok_({ id: id });
  } catch (e) {
    return fail_(e.message);
  }
}

function getCustomerDocsFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('CUSTOMER_DOCS_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  var folder = DriveApp.createFolder('SHSklad_CustomerDocs');
  props.setProperty('CUSTOMER_DOCS_FOLDER_ID', folder.getId());
  return folder;
}

function updateCustomerOrderStatus(token, orderId, newStatus) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var sheet = getDb_().getSheetByName(SHEET_CUSTOMER_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === orderId) {
        sheet.getRange(i + 1, idx.Status + 1).setValue(newStatus);
        logHistory_(user, 'Статус замовлення клієнта змінено', '', data[i][idx.ClientName], 0, 'Новий статус: ' + newStatus);
        return ok_(true);
      }
    }
    return fail_('Замовлення не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteCustomerOrder(token, orderId) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_CUSTOMER_ORDERS);
    var data = sheet.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === orderId) { sheet.deleteRow(i + 1); found = true; break; }
    }
    if (!found) return fail_('Замовлення не знайдено.');

    var itemsSheet = ss.getSheetByName(SHEET_CUSTOMER_ORDER_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    for (var j = itemsData.length - 1; j >= 1; j--) {
      if (itemsData[j][1] === orderId) itemsSheet.deleteRow(j + 1);
    }
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Створює виробничі замовлення для ВСІХ позицій цього замовлення клієнта,
 * які ще не мають прив'язаного виробничого замовлення. Кожна позиція
 * обробляється незалежно — якщо на одну не вистачає компонентів, інші
 * все одно створяться, а ця потрапить у список помилок.
 */
/**
 * Рекурсивно збирає нестачу товарів, які треба замовити постачальникам,
 * спускаючись углиб по вкладених виробах: якщо якогось виробу-компонента не
 * вистачає і для нього НЕ призначено постачальника (тобто виготовляємо самі),
 * функція йде в його власні компоненти і перевіряє нестачу вже там — і так,
 * доки не дійде до товарів або до виробу, який купуємо готовим.
 *
 * ВАЖЛИВО: productPool і fgPool — СПІЛЬНІ, змінювані "пули залишку" для
 * ВСЬОГО замовлення клієнта (не для одного виробу окремо!). Якщо два різні
 * вироби в одному замовленні використовують той самий товар чи ту саму
 * деталь — вони мають ділити один і той самий залишок, а не кожен рахувати
 * "у мене вистачає" проти повного залишку незалежно один від одного. Саме
 * цей спільний пул і виправляє заниження нестачі при спільних компонентах.
 *
 * groups: supplierId ('' = без постачальника) -> { supplierName, items: {key: {...}} }
 */
/**
 * Рекурсивно збирає ПОВНУ потребу в товарах для всіх виробів замовлення
 * клієнта, спускаючись углиб по вкладених виробах, які виготовляємо самі.
 *
 * СВІДОМО НЕ віднімає поточний залишок на складі й не робить жодної
 * "розумної" арифметики з резервами — це джерело помилок і втрати довіри
 * до чисел. Натомість повертає ПОВНУ потрібну кількість по кожній позиції,
 * а поточний залишок показується ОКРЕМО (currentStock) — людина сама
 * бачить обидва числа і сама коригує кількість у заявці, а не система
 * "вирішує" це мовчки.
 *
 * groups: supplierId ('' = без постачальника) -> { supplierName, items: {key: {...}} }
 */
function collectShortageGroups_(assemblyId, qtyNeeded, fgAvailability, visited, groups) {
  visited = visited || {};
  if (visited[assemblyId]) return; // захист від зациклення в специфікації
  var nextVisited = Object.assign({}, visited);
  nextVisited[assemblyId] = true;

  function addToGroup(supplierId, supplierName, article, name, qty, expectedPrice, photoUrl, currentStock) {
    if (!groups[supplierId]) groups[supplierId] = { supplierName: supplierName, items: {} };
    var key = article || name;
    if (!groups[supplierId].items[key]) groups[supplierId].items[key] = { article: article, name: name, qty: 0, expectedPrice: expectedPrice, photoUrl: photoUrl || '', currentStock: currentStock };
    groups[supplierId].items[key].qty = round2_(groups[supplierId].items[key].qty + qty);
  }

  var components = getAssemblyComponents_(assemblyId, fgAvailability);
  components.forEach(function (c) {
    var needed = c.qty * qtyNeeded;

    if (c.componentType === 'assembly') {
      if (!c.subAssembly) return;
      if (c.subAssembly.supplierIdForPurchase) {
        // Цей виріб купуємо готовим — заявка постачальнику саме на нього,
        // повна потрібна кількість (поточний залишок показуємо окремо).
        addToGroup(c.subAssembly.supplierIdForPurchase, c.subAssembly.supplierNameForPurchase || '',
          c.subAssembly.article || '', c.subAssembly.name + ' [виріб]', needed, 0, c.subAssembly.photoUrl,
          (fgAvailability[c.subAssemblyId] || { count: 0 }).count);
      } else {
        // Виготовляємо самі — спускаємось у ЙОГО компоненти з ПОВНОЮ
        // потрібною кількістю (без віднімання того, що вже, можливо, є
        // готовим на складі — це теж людина побачить і оцінить сама).
        collectShortageGroups_(c.subAssemblyId, needed, fgAvailability, nextVisited, groups);
      }
      return;
    }

    if (!c.product) return;
    addToGroup(c.product.defaultSupplierId || '', '', c.product.article, c.product.name, needed, c.product.sellPriceEur || 0, c.product.photoUrl, c.product.qty);
  });
}

function getCustomerOrderItems_(customerOrderId) {
  var itemsSheet = getDb_().getSheetByName(SHEET_CUSTOMER_ORDER_ITEMS);
  var itemsData = itemsSheet.getDataRange().getValues();
  var itemsIdx = indexMap_(itemsData[0]);
  var orderItems = [];
  for (var i = 1; i < itemsData.length; i++) {
    if (itemsData[i][itemsIdx.CustomerOrderID] === customerOrderId) {
      orderItems.push({ assemblyId: itemsData[i][itemsIdx.AssemblyID], qty: Number(itemsData[i][itemsIdx.Qty]) || 0 });
    }
  }
  return orderItems;
}

function buildShortageGroups_(customerOrderId) {
  var orderItems = getCustomerOrderItems_(customerOrderId);
  if (!orderItems.length) return null;

  var fgAvailability = getFinishedGoodsAvailability_();
  var groups = {};
  orderItems.forEach(function (oi) {
    collectShortageGroups_(oi.assemblyId, oi.qty, fgAvailability, {}, groups);
  });
  return groups;
}

function resolveSupplierNames_(groups) {
  var suppliersSheet = getDb_().getSheetByName(SHEET_SUPPLIERS);
  var suppliersData = suppliersSheet.getDataRange().getValues();
  var suppliersIdx = indexMap_(suppliersData[0]);
  var supplierNameById = {};
  for (var s = 1; s < suppliersData.length; s++) {
    if (suppliersData[s][suppliersIdx.ID]) supplierNameById[suppliersData[s][suppliersIdx.ID]] = suppliersData[s][suppliersIdx.Name];
  }
  return supplierNameById;
}

/**
 * Попередній перегляд заявок постачальникам (без запису в базу) — щоб можна
 * було вручну відкоригувати кількості/позиції перед фактичним створенням.
 */
function previewSupplierRequestsFromCustomerOrder(token, customerOrderId) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    var groups = buildShortageGroups_(customerOrderId);
    if (!groups) return fail_('У замовленні немає позицій.');
    var supplierNameById = resolveSupplierNames_(groups);

    var result = Object.keys(groups).map(function (supplierId) {
      var group = groups[supplierId];
      var items = Object.keys(group.items).map(function (k) { return group.items[k]; });
      return {
        supplierId: supplierId,
        supplierName: supplierId ? (supplierNameById[supplierId] || '(постачальника видалено)') : 'без постачальника',
        items: items
      };
    }).filter(function (g) { return g.items.length; });

    return ok_(result.length ? result : []);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Фактичне створення заявок постачальникам — на основі (можливо, вручну
 * відкоригованих на клієнті) груп із попереднього перегляду.
 * groups = [{ supplierId, supplierName, items: [{article, name, qty, expectedPrice}] }]
 */
function createPurchaseOrdersFromGroups(token, customerOrderId, groups) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    if (!groups || !groups.length) return fail_('Немає жодної позиції для замовлення.');

    var ss = getDb_();
    var poSheet = ss.getSheetByName(SHEET_PURCHASE_ORDERS);
    var poItemsSheet = ss.getSheetByName(SHEET_PURCHASE_ORDER_ITEMS);
    var createdOrders = [];

    groups.forEach(function (group) {
      var items = (group.items || []).filter(function (it) { return Number(it.qty) > 0; });
      if (!items.length) return;

      var id = newId_();
      poSheet.appendRow([
        id, group.supplierName || 'без постачальника', group.supplierId || '', 'ordered', nowStr_(), '',
        '', '', 'Сформовано із замовлення клієнта', user.fullName || user.login, nowStr_(), customerOrderId
      ]);
      items.forEach(function (it) {
        poItemsSheet.appendRow([newId_(), id, it.article || '', it.name || '', Number(it.qty) || 0, 0, Number(it.expectedPrice) || 0, '']);
      });
      createdOrders.push({ id: id, supplierName: group.supplierName || 'без постачальника', itemCount: items.length });
    });

    if (!createdOrders.length) return fail_('Немає жодної позиції з кількістю більше нуля.');

    logHistory_(user, 'Створення заявок постачальникам', '', '', createdOrders.length,
      'Із замовлення клієнта, створено заявок: ' + createdOrders.length);

    return ok_({ createdOrders: createdOrders });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Дати в роботу ОДНУ конкретну позицію замовлення клієнта (не все замовлення
 * одразу) — це і є "поетапне" виробництво: одні вироби зараз, інші пізніше.
 */
function createProductionOrderForItem(token, customerOrderItemId) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var ss = getDb_();
    var itemsSheet = ss.getSheetByName(SHEET_CUSTOMER_ORDER_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsIdx = indexMap_(itemsData[0]);

    var rowNum = -1, row = null;
    for (var i = 1; i < itemsData.length; i++) {
      if (itemsData[i][itemsIdx.ID] === customerOrderItemId) { rowNum = i + 1; row = itemsData[i]; break; }
    }
    if (!row) return fail_('Позицію замовлення не знайдено.');
    if (row[itemsIdx.ProductionOrderID]) return fail_('Для цієї позиції вже створено виробниче замовлення.');

    var orderId = row[itemsIdx.CustomerOrderID];
    var res = createProductionOrder(token, row[itemsIdx.AssemblyID], row[itemsIdx.Qty], 'Замовлення клієнта: ' + orderId);
    if (!res.success) return res;

    itemsSheet.getRange(rowNum, itemsIdx.ProductionOrderID + 1).setValue(res.data.id);

    // Якщо це перша позиція, яку дали в роботу — переводимо статус замовлення.
    var coSheet = ss.getSheetByName(SHEET_CUSTOMER_ORDERS);
    var coData = coSheet.getDataRange().getValues();
    var coIdx = indexMap_(coData[0]);
    for (var j = 1; j < coData.length; j++) {
      if (coData[j][coIdx.ID] === orderId && coData[j][coIdx.Status] === 'new') {
        coSheet.getRange(j + 1, coIdx.Status + 1).setValue('in_production');
        break;
      }
    }

    logHistory_(user, 'Дано в роботу (поетапно)', '', row[itemsIdx.AssemblyName], row[itemsIdx.Qty],
      'Із замовлення клієнта: ' + orderId);

    return ok_({ productionOrderId: res.data.id });
  } catch (e) {
    return fail_(e.message);
  }
}

function createProductionOrdersFromCustomerOrder(token, orderId) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var ss = getDb_();
    var itemsSheet = ss.getSheetByName(SHEET_CUSTOMER_ORDER_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsIdx = indexMap_(itemsData[0]);

    var created = 0, errors = [];
    for (var i = 1; i < itemsData.length; i++) {
      var row = itemsData[i];
      if (row[itemsIdx.CustomerOrderID] !== orderId) continue;
      if (row[itemsIdx.ProductionOrderID]) continue; // вже створено раніше

      var res = createProductionOrder(token, row[itemsIdx.AssemblyID], row[itemsIdx.Qty],
        'Замовлення клієнта: ' + orderId);
      if (res.success) {
        itemsSheet.getRange(i + 1, itemsIdx.ProductionOrderID + 1).setValue(res.data.id);
        created++;
      } else {
        errors.push(row[itemsIdx.AssemblyName] + ': ' + res.message);
      }
    }

    if (created > 0) {
      var coSheet = ss.getSheetByName(SHEET_CUSTOMER_ORDERS);
      var coData = coSheet.getDataRange().getValues();
      var coIdx = indexMap_(coData[0]);
      for (var j = 1; j < coData.length; j++) {
        if (coData[j][coIdx.ID] === orderId) {
          coSheet.getRange(j + 1, coIdx.Status + 1).setValue('in_production');
          break;
        }
      }
      logHistory_(user, 'Створено виробничі замовлення з замовлення клієнта', '', '', created, errors.length ? ('Помилок: ' + errors.length) : '');
    }

    return ok_({ created: created, errors: errors });
  } catch (e) {
    return fail_(e.message);
  }
}
