/**
 * ProductionOrders.gs — облік запуску виробів у роботу.
 *
 * Життєвий цикл замовлення на виробництво:
 *   'planned'   — щойно створене: резервує потрібні компоненти зі складу
 *                 (фізично зі складу нічого не списується, але залишок
 *                 "доступно" для інших замовлень/сповіщень зменшується).
 *   'completed' — після натискання "Запустити в роботу": компоненти реально
 *                 списуються зі складу, генерується аркуш видачі для друку.
 *
 * Резервування НЕ зберігається окремим числом у товарі (щоб не розсинхронізувалось) —
 * воно завжди рахується "на льоту" сумою по всіх активних ('planned') замовленнях.
 */

/**
 * Експорт історії виробництва в Excel — з фіксованою собівартістю на момент
 * запуску кожного замовлення (а не поточними цінами). Лише для admin.
 */
function exportProductionOrders(token) {
  try {
    requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTION_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var rows = [['Виріб', 'Кількість', 'Статус', 'Хто', 'Створено', 'Завершено', 'Собівартість наша (EUR)', 'Собівартість німецька (EUR)', 'Коментар']];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      rows.push([
        row[idx.AssemblyName],
        row[idx.UnitsPlanned],
        row[idx.Status] === 'completed' ? 'Завершено' : (row[idx.Status] === 'in_progress' ? 'В роботі' : 'Заплановано'),
        row[idx.User],
        row[idx.CreatedAt],
        row[idx.CompletedAt],
        row[idx.TotalLocalCostEur],
        row[idx.TotalGermanCostEur],
        row[idx.Comment]
      ]);
    }
    return ok_(rows);
  } catch (e) {
    return fail_(e.message);
  }
}

function stripPickListPrices_(pickList, user) {
  if (user.role === 'admin') return pickList;
  return pickList.map(function (item) {
    var copy = Object.assign({}, item);
    delete copy.priceEur;
    delete copy.lineTotalEur;
    return copy;
  });
}

function listProductionOrders(token, statusFilter) {
  try {
    var user = requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTION_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var list = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      if (statusFilter && row[idx.Status] !== statusFilter) continue;
      var item = {
        id: row[idx.ID],
        assemblyId: row[idx.AssemblyID],
        assemblyName: row[idx.AssemblyName],
        unitsPlanned: Number(row[idx.UnitsPlanned]) || 0,
        status: row[idx.Status],
        user: row[idx.User],
        createdAt: row[idx.CreatedAt],
        completedAt: row[idx.CompletedAt],
        comment: row[idx.Comment],
        currentStageIndex: row[idx.CurrentStageIndex] !== '' ? Number(row[idx.CurrentStageIndex]) : null
      };
      if (user.role === 'admin' && row[idx.Status] !== 'planned') {
        item.totalLocalCostEur = Number(row[idx.TotalLocalCostEur]) || 0;
        item.totalGermanCostEur = Number(row[idx.TotalGermanCostEur]) || 0;
        item.fullCostEur = Number(row[idx.FullCostEur]) || 0;
      }
      list.push(item);
    }
    list.reverse();
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Скільки одиниць кожного товару зараз зарезервовано під заплановані
 * (ще не запущені) замовлення на виробництво. Використовується для
 * "доступного" залишку в getStats/getLowStockProducts/картці товару.
 */
function getReservedQtyMap_() {
  var ss = getDb_();

  var ordersSheet = ss.getSheetByName(SHEET_PRODUCTION_ORDERS);
  var ordersData = ordersSheet.getDataRange().getValues();
  var ordersIdx = indexMap_(ordersData[0]);

  // Читаємо AssemblyComponents ОДИН раз і групуємо по assemblyId в пам'яті —
  // раніше це читалось заново (разом із ПОВНИМ каталогом товарів!) на кожне
  // окреме замовлення в циклі нижче, що при великій кількості товарів давало
  // хвилини очікування дашборду.
  var compSheet = ss.getSheetByName(SHEET_ASSEMBLY_COMPONENTS);
  var compData = compSheet.getDataRange().getValues();
  var compIdx = indexMap_(compData[0]);
  var componentsByAssembly = {};
  for (var c = 1; c < compData.length; c++) {
    var compRow = compData[c];
    if (!compRow[compIdx.ID]) continue;
    if ((compRow[compIdx.ComponentType] || 'product') !== 'product') continue; // компоненти-вироби рахуємо окремо
    var asmId = compRow[compIdx.AssemblyID];
    if (!componentsByAssembly[asmId]) componentsByAssembly[asmId] = [];
    componentsByAssembly[asmId].push({
      productId: compRow[compIdx.ProductID],
      qty: Number(compRow[compIdx.Qty]) || 0
    });
  }

  var reserved = {}; // productId -> qty

  for (var i = 1; i < ordersData.length; i++) {
    var row = ordersData[i];
    if (!row[ordersIdx.ID] || row[ordersIdx.Status] !== 'planned') continue;
    var units = Number(row[ordersIdx.UnitsPlanned]) || 0;
    var components = componentsByAssembly[row[ordersIdx.AssemblyID]] || [];
    components.forEach(function (comp) {
      reserved[comp.productId] = (reserved[comp.productId] || 0) + comp.qty * units;
    });
  }
  return reserved;
}

/**
 * Аналогічно getReservedQtyMap_, але для компонентів-виробів (готових
 * виробів, які використовуються як складова іншого виробу) — скільки
 * одиниць кожного вже "обіцяно" іншим запланованим замовленням.
 */
function getReservedFinishedGoodsMap_() {
  var ss = getDb_();
  var ordersSheet = ss.getSheetByName(SHEET_PRODUCTION_ORDERS);
  var ordersData = ordersSheet.getDataRange().getValues();
  var ordersIdx = indexMap_(ordersData[0]);

  var compSheet = ss.getSheetByName(SHEET_ASSEMBLY_COMPONENTS);
  var compData = compSheet.getDataRange().getValues();
  var compIdx = indexMap_(compData[0]);
  var subComponentsByAssembly = {};
  for (var c = 1; c < compData.length; c++) {
    var compRow = compData[c];
    if (!compRow[compIdx.ID] || compRow[compIdx.ComponentType] !== 'assembly') continue;
    var asmId = compRow[compIdx.AssemblyID];
    if (!subComponentsByAssembly[asmId]) subComponentsByAssembly[asmId] = [];
    subComponentsByAssembly[asmId].push({
      subAssemblyId: compRow[compIdx.SubAssemblyID],
      qty: Number(compRow[compIdx.Qty]) || 0
    });
  }

  var reserved = {}; // subAssemblyId -> кількість готових одиниць, вже "обіцяних"
  for (var i = 1; i < ordersData.length; i++) {
    var row = ordersData[i];
    if (!row[ordersIdx.ID] || row[ordersIdx.Status] !== 'planned') continue;
    var units = Number(row[ordersIdx.UnitsPlanned]) || 0;
    var subComponents = subComponentsByAssembly[row[ordersIdx.AssemblyID]] || [];
    subComponents.forEach(function (comp) {
      reserved[comp.subAssemblyId] = (reserved[comp.subAssemblyId] || 0) + comp.qty * units;
    });
  }
  return reserved;
}

/**
 * Створити замовлення на виробництво (плановане, резервує компоненти).
 * Перевіряє, чи вистачає ДОСТУПНОГО залишку (з урахуванням уже існуючих резервів).
 */
function createProductionOrder(token, assemblyId, unitsPlanned, comment) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    unitsPlanned = Number(unitsPlanned) || 0;
    if (unitsPlanned <= 0) return fail_('Вкажіть кількість виробів.');

    var ss = getDb_();
    var asmSheet = ss.getSheetByName(SHEET_ASSEMBLIES);
    var asmData = asmSheet.getDataRange().getValues();
    var asmIdx = indexMap_(asmData[0]);
    var assemblyName = '';
    for (var i = 1; i < asmData.length; i++) {
      if (asmData[i][asmIdx.ID] === assemblyId) { assemblyName = asmData[i][asmIdx.Name]; break; }
    }
    if (!assemblyName) return fail_('Виріб не знайдено.');

    var components = getAssemblyComponents_(assemblyId);
    if (!components.length) return fail_('У виробі немає компонентів.');

    var reserved = getReservedQtyMap_();
    var reservedFg = getReservedFinishedGoodsMap_();
    var shortages = [];
    components.forEach(function (c) {
      var needed = c.qty * unitsPlanned;
      if (c.componentType === 'assembly') {
        var availableCount = (c.subAssembly ? c.subAssembly.availableInStock : 0) - (reservedFg[c.subAssemblyId] || 0);
        if (availableCount < needed) {
          shortages.push((c.subAssembly ? c.subAssembly.name : '(виріб видалено)') + ' (готовий виріб): потрібно ' + needed + ', доступно ' + Math.max(0, availableCount));
        }
        return;
      }
      if (!c.product) { shortages.push('Товар видалено зі складу (ID: ' + c.productId + ')'); return; }
      var alreadyReserved = reserved[c.productId] || 0;
      var available = c.product.qty - alreadyReserved;
      if (available < needed) {
        shortages.push(c.product.name + ': потрібно ' + needed + ', доступно ' + available + ' (з урахуванням інших резервів)');
      }
    });
    if (shortages.length) return fail_('Недостатньо доступних залишків: ' + shortages.join('; '));

    var id = newId_();
    var sheet = ss.getSheetByName(SHEET_PRODUCTION_ORDERS);
    var bomVersion = getLatestAssemblyVersionNumber_(assemblyId);
    sheet.appendRow([
      id, assemblyId, assemblyName, unitsPlanned, 'planned', user.fullName || user.login, nowStr_(), '', comment || '', '',
      '', '', '', '', bomVersion,
      '', '', '', '', '', ''
    ]);

    logHistory_(user, 'Заплановано виріб', '', assemblyName, unitsPlanned, 'Зарезервовано зі складу' + (comment ? ' — ' + comment : '') + (bomVersion ? ' (специфікація v' + bomVersion + ')' : ''));
    return ok_({ id: id });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Запустити заплановане замовлення в роботу: реально списує компоненти зі
 * складу (перевіряючи фізичну наявність — не лише резерв) і повертає готовий
 * аркуш видачі для друку.
 */
function startProductionOrder(token, orderId, extraCosts, assignedWorkers) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_PRODUCTION_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var rowNum = null, order = null;
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === orderId) { rowNum = i + 1; order = data[i]; break; }
    }
    if (!order) return fail_('Замовлення не знайдено.');
    if (order[idx.Status] !== 'planned') return fail_('Це замовлення вже запущено в роботу раніше.');

    var assemblyId = order[idx.AssemblyID];
    var assemblyName = order[idx.AssemblyName];
    var unitsToProduce = Number(order[idx.UnitsPlanned]) || 0;
    var lockedBomVersion = order[idx.BOMVersionNumber];

    // Використовуємо саме ТУ специфікацію, яка була чинною в момент
    // резервування (createProductionOrder) — а не поточну. Якщо рецепт
    // виробу змінили вже ПІСЛЯ того, як це замовлення запланували, ми все
    // одно спишемо те, що реально було заплановано, а не щось інше.
    var components = lockedBomVersion
      ? getAssemblyComponentsAtVersion_(assemblyId, lockedBomVersion)
      : getAssemblyComponents_(assemblyId); // старі замовлення без збереженої версії — fallback
    var shortages = [];
    components.forEach(function (c) {
      var needed = c.qty * unitsToProduce;
      if (c.componentType === 'assembly') {
        var availableCount = c.subAssembly ? c.subAssembly.availableInStock : 0;
        if (availableCount < needed) shortages.push((c.subAssembly ? c.subAssembly.name : '(виріб видалено)') + ' (готовий виріб): потрібно ' + needed + ', наявно ' + availableCount);
        return;
      }
      if (!c.product) { shortages.push('Товар видалено зі складу (ID: ' + c.productId + ')'); return; }
      if (c.product.qty < needed) shortages.push(c.product.name + ': потрібно ' + needed + ', наявно ' + c.product.qty);
    });
    if (shortages.length) return fail_('Недостатньо залишків: ' + shortages.join('; '));

    var pickList = [];
    var materialsCostLocal = 0, materialsCostGerman = 0;
    var subAssemblyCostLocal = 0, subAssemblyCostGerman = 0;

    components.forEach(function (c) {
      var needed = c.qty * unitsToProduce;

      if (c.componentType === 'assembly') {
        // Списуємо КОНКРЕТНІ серійні номери (найстаріші спершу) — не просто число.
        var consumed = consumeFinishedGoods_(c.subAssemblyId, needed, orderId);
        subAssemblyCostLocal += consumed.totalCostLocal;
        subAssemblyCostGerman += consumed.totalCostGerman;

        logHistory_(user, 'Використано готовий виріб як компонент', '', c.subAssembly ? c.subAssembly.name : '', -needed,
          'Виріб: ' + assemblyName + ' × ' + unitsToProduce + '. Серійні номери: ' + consumed.serials.join(', '));

        pickList.push({
          article: c.subAssembly ? (c.subAssembly.article || '') : '', code: '', name: (c.subAssembly ? c.subAssembly.name : '(виріб видалено)') + ' [готовий виріб]',
          cell: '', unit: 'шт', qty: needed, photoUrl: c.subAssembly ? c.subAssembly.photoUrl : '',
          priceEur: needed ? round2_(consumed.totalCostLocal / needed) : 0,
          lineTotalEur: round2_(consumed.totalCostLocal),
          consumedSerials: consumed.serials
        });
        return;
      }

      var found = findProductRow_(c.productId);
      if (!found) return;
      var newQty = Number(found.row[found.idx.Qty]) - needed;
      found.sheet.getRange(found.rowNum, found.idx.Qty + 1).setValue(newQty);
      found.sheet.getRange(found.rowNum, found.idx.UpdatedAt + 1).setValue(nowStr_());
      if (c.warehouseId) adjustWarehouseStock_(c.productId, c.warehouseId, -needed);

      logHistory_(user, 'Списання на виріб', found.row[found.idx.Article], found.row[found.idx.Name], -needed,
        'Виріб: ' + assemblyName + ' × ' + unitsToProduce);

      var priceLocal = Number(found.row[found.idx.SellPriceEUR]) || 0;
      var priceGerman = Number(found.row[found.idx.GermanPriceExclVat]) || 0;
      materialsCostLocal += priceLocal * needed;
      materialsCostGerman += priceGerman * needed;

      pickList.push({
        article: found.row[found.idx.Article], code: found.row[found.idx.Code],
        name: found.row[found.idx.Name], cell: found.row[found.idx.Cell],
        unit: found.row[found.idx.Unit], qty: needed,
        photoUrl: found.row[found.idx.PhotoUrl],
        priceEur: priceLocal, lineTotalEur: round2_(priceLocal * needed)
      });
    });

    // Собівартість рахуємо ЗА ПОТОЧНИМИ цінами компонентів-товарів + РЕАЛЬНОЮ
    // собівартістю конкретно спожитих серійних номерів компонентів-виробів
    // (не приблизною оцінкою) — і зберігаємо НАЗАВЖДИ разом із замовленням.
    // Якщо ціна постачальника пізніше зміниться, цей запис не "поїде" —
    // саме тому вона не рахується щоразу наново з нуля, а фіксується один раз тут.
    var totalLocal = round2_(materialsCostLocal + subAssemblyCostLocal);
    var totalGerman = round2_(materialsCostGerman + subAssemblyCostGerman);

    // Додаткові статті витрат (праця, пакування, доставка, інше) — за
    // замовчуванням беремо ставку на одиницю, вказану у виробі, помножену на
    // кількість, але дозволяємо ввести фактичну суму саме на цей запуск
    // (наприклад, реальну вартість доставки цієї конкретної партії).
    var asmSheet2 = getDb_().getSheetByName(SHEET_ASSEMBLIES);
    var asmData2 = asmSheet2.getDataRange().getValues();
    var asmIdx2 = indexMap_(asmData2[0]);
    var laborDefault = 0, packagingDefault = 0, deliveryDefault = 0, otherDefault = 0;
    var drawingFileUrl = '', drawingFileName = '', drawingMimeType = '', drawingOriginalUrl = '';
    for (var ai = 1; ai < asmData2.length; ai++) {
      if (asmData2[ai][asmIdx2.ID] === assemblyId) {
        laborDefault = numOrZero_(asmData2[ai][asmIdx2.LaborCostPerUnit]) * unitsToProduce;
        packagingDefault = numOrZero_(asmData2[ai][asmIdx2.PackagingCostPerUnit]) * unitsToProduce;
        deliveryDefault = numOrZero_(asmData2[ai][asmIdx2.DeliveryCostPerUnit]) * unitsToProduce;
        otherDefault = numOrZero_(asmData2[ai][asmIdx2.OtherCostPerUnit]) * unitsToProduce;
        drawingFileUrl = asmData2[ai][asmIdx2.DrawingFileUrl] || '';
        drawingFileName = asmData2[ai][asmIdx2.DrawingFileName] || '';
        drawingMimeType = asmData2[ai][asmIdx2.DrawingMimeType] || '';
        drawingOriginalUrl = asmData2[ai][asmIdx2.DrawingOriginalUrl] || '';
        break;
      }
    }
    extraCosts = extraCosts || {};
    var laborCost = round2_(extraCosts.laborCostEur != null ? Number(extraCosts.laborCostEur) : laborDefault);
    var packagingCost = round2_(extraCosts.packagingCostEur != null ? Number(extraCosts.packagingCostEur) : packagingDefault);
    var deliveryCost = round2_(extraCosts.deliveryCostEur != null ? Number(extraCosts.deliveryCostEur) : deliveryDefault);
    var otherCost = round2_(extraCosts.otherCostEur != null ? Number(extraCosts.otherCostEur) : otherDefault);
    var fullCost = round2_(totalLocal + laborCost + packagingCost + deliveryCost + otherCost);

    var now = nowStr_();
    var stagesCount = ss.getSheetByName(SHEET_PRODUCTION_STAGES).getDataRange().getValues().length - 1;
    var newStatus = stagesCount > 0 ? 'in_progress' : 'completed';
    sheet.getRange(rowNum, idx.Status + 1).setValue(newStatus);
    if (newStatus === 'completed') sheet.getRange(rowNum, idx.CompletedAt + 1).setValue(now);
    sheet.getRange(rowNum, idx.PickListJson + 1).setValue(JSON.stringify(pickList));
    sheet.getRange(rowNum, idx.TotalLocalCostEur + 1).setValue(totalLocal);
    sheet.getRange(rowNum, idx.TotalGermanCostEur + 1).setValue(totalGerman);
    sheet.getRange(rowNum, idx.LaborCostEur + 1).setValue(laborCost);
    sheet.getRange(rowNum, idx.PackagingCostEur + 1).setValue(packagingCost);
    sheet.getRange(rowNum, idx.DeliveryCostEur + 1).setValue(deliveryCost);
    sheet.getRange(rowNum, idx.OtherCostEur + 1).setValue(otherCost);
    sheet.getRange(rowNum, idx.FullCostEur + 1).setValue(fullCost);

    // Відрядна оплата: якщо призначені працівники, ставка за виріб (laborCost,
    // яку ми щойно порахували) ділиться між ними за відсотками — і одразу
    // з'являється як нарахування в зарплатному журналі кожного.
    var normalizedWorkers = [];
    if (assignedWorkers && assignedWorkers.length) {
      var totalPercent = assignedWorkers.reduce(function (sum, w) { return sum + (Number(w.percent) || 0); }, 0);
      if (totalPercent > 0) {
        normalizedWorkers = assignedWorkers.map(function (w) {
          return { employeeId: w.employeeId, percent: round2_((Number(w.percent) || 0) / totalPercent * 100) };
        });
        sheet.getRange(rowNum, idx.AssignedWorkersJson + 1).setValue(JSON.stringify(normalizedWorkers));
        createPayrollEntriesForOrder_(orderId, assemblyName, unitsToProduce, laborCost, normalizedWorkers, user);
      }
    }

    // Знаходимо, чи це замовлення на виробництво пов'язане з якимось
    // замовленням клієнта (через CustomerOrderItems.ProductionOrderID) —
    // якщо так, готові вироби одразу отримають цей зв'язок.
    var linkedCustomerOrderId = '';
    try {
      var coItemsSheet = getDb_().getSheetByName(SHEET_CUSTOMER_ORDER_ITEMS);
      var coItemsData = coItemsSheet.getDataRange().getValues();
      var coItemsIdx = indexMap_(coItemsData[0]);
      for (var ci = 1; ci < coItemsData.length; ci++) {
        if (coItemsData[ci][coItemsIdx.ProductionOrderID] === orderId) {
          linkedCustomerOrderId = coItemsData[ci][coItemsIdx.CustomerOrderID];
          break;
        }
      }
    } catch (e) {}

    var unitCostLocal = unitsToProduce > 0 ? fullCost / unitsToProduce : 0;
    var unitCostGerman = unitsToProduce > 0 ? totalGerman / unitsToProduce : 0;
    var serials = createFinishedGoods_(assemblyId, assemblyName, orderId, unitsToProduce, linkedCustomerOrderId, unitCostLocal, unitCostGerman);

    logHistory_(user, 'Запуск виробу в роботу', '', assemblyName, unitsToProduce,
      'Собівартість: ' + totalLocal + ' EUR (за ціною продажу) / ' + totalGerman + ' EUR (німецька). Серійні номери: ' + serials.join(', '));

    var response = {
      unitsProduced: unitsToProduce, assemblyName: assemblyName, pickList: stripPickListPrices_(pickList, user), serials: serials,
      drawingFileUrl: drawingFileUrl, drawingFileName: drawingFileName, drawingMimeType: drawingMimeType, drawingOriginalUrl: drawingOriginalUrl
    };
    if (user.role === 'admin') {
      response.totalLocalCostEur = totalLocal;
      response.totalGermanCostEur = totalGerman;
      response.laborCostEur = laborCost;
      response.packagingCostEur = packagingCost;
      response.deliveryCostEur = deliveryCost;
      response.otherCostEur = otherCost;
      response.fullCostEur = fullCost;
    }
    return ok_(response);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Скасувати заплановане (ще не запущене) замовлення — знімає резервацію.
 */
function cancelProductionOrder(token, orderId) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTION_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === orderId) {
        if (data[i][idx.Status] !== 'planned') return fail_('Запущене або завершене замовлення скасувати не можна.');
        sheet.deleteRow(i + 1);
        logHistory_(user, 'Скасовано замовлення на виріб', '', data[i][idx.AssemblyName], 0, '');
        return ok_(true);
      }
    }
    return fail_('Замовлення не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Повторний друк аркуша видачі для вже завершеного замовлення.
 */
function getProductionOrderPickList(token, orderId) {
  try {
    var user = requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTION_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === orderId) {
        var pickList = [];
        try { pickList = JSON.parse(data[i][idx.PickListJson] || '[]'); } catch (e) {}

        var drawingFileUrl = '', drawingFileName = '', drawingMimeType = '', drawingOriginalUrl = '';
        var asmSheet3 = getDb_().getSheetByName(SHEET_ASSEMBLIES);
        var asmData3 = asmSheet3.getDataRange().getValues();
        var asmIdx3 = indexMap_(asmData3[0]);
        for (var aj = 1; aj < asmData3.length; aj++) {
          if (asmData3[aj][asmIdx3.ID] === data[i][idx.AssemblyID]) {
            drawingFileUrl = asmData3[aj][asmIdx3.DrawingFileUrl] || '';
            drawingFileName = asmData3[aj][asmIdx3.DrawingFileName] || '';
            drawingMimeType = asmData3[aj][asmIdx3.DrawingMimeType] || '';
            drawingOriginalUrl = asmData3[aj][asmIdx3.DrawingOriginalUrl] || '';
            break;
          }
        }

        return ok_({
          assemblyName: data[i][idx.AssemblyName],
          unitsProduced: Number(data[i][idx.UnitsPlanned]) || 0,
          pickList: stripPickListPrices_(pickList, user),
          drawingFileUrl: drawingFileUrl, drawingFileName: drawingFileName, drawingMimeType: drawingMimeType, drawingOriginalUrl: drawingOriginalUrl
        });
      }
    }
    return fail_('Замовлення не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}
