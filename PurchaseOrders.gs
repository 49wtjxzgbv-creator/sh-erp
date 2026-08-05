/**
 * PurchaseOrders.gs — замовлення постачальникам (мультипозиційно, як справжня накладна).
 *
 * Одне замовлення = один постачальник + кілька позицій (артикул + кількість).
 * Можна прикріпити файл накладної (фото/PDF/скан) — зберігається на Google Диску.
 * Прихід можна провести ПРЯМО з картки замовлення — не треба шукати товари
 * окремо на сторінці "Товари": кожна позиція одразу підказує, скільки
 * замовлено і скільки вже отримано, і дозволяє ввести фактичну кількість.
 */

function listPurchaseOrders(token, statusFilter) {
  try {
    requireAuth_(token);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_PURCHASE_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var itemsSheet = ss.getSheetByName(SHEET_PURCHASE_ORDER_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsIdx = indexMap_(itemsData[0]);
    var itemCounts = {};
    for (var j = 1; j < itemsData.length; j++) {
      var poId = itemsData[j][itemsIdx.PurchaseOrderID];
      if (!poId) continue;
      itemCounts[poId] = (itemCounts[poId] || 0) + 1;
    }

    var list = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      if (statusFilter && row[idx.Status] !== statusFilter) continue;
      list.push({
        id: row[idx.ID],
        supplier: row[idx.Supplier],
        status: row[idx.Status],
        orderDate: row[idx.OrderDate],
        expectedDeliveryDate: row[idx.ExpectedDeliveryDate],
        invoiceFileUrl: row[idx.InvoiceFileUrl],
        invoiceFileName: row[idx.InvoiceFileName],
        comment: row[idx.Comment],
        createdBy: row[idx.CreatedBy],
        itemCount: itemCounts[row[idx.ID]] || 0,
        isOverdue: row[idx.Status] !== 'delivered' && row[idx.ExpectedDeliveryDate] &&
          new Date(row[idx.ExpectedDeliveryDate]) < new Date()
      });
    }
    list.reverse();
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

function getPurchaseOrder(token, orderId) {
  try {
    requireAuth_(token);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_PURCHASE_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var orderRow = null;
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === orderId) { orderRow = data[i]; break; }
    }
    if (!orderRow) return fail_('Замовлення не знайдено.');

    var itemsSheet = ss.getSheetByName(SHEET_PURCHASE_ORDER_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsIdx = indexMap_(itemsData[0]);
    var items = [];
    var totalCost = 0;
    for (var j = 1; j < itemsData.length; j++) {
      var row = itemsData[j];
      if (row[itemsIdx.PurchaseOrderID] !== orderId) continue;
      var expectedPrice = Number(row[itemsIdx.ExpectedPrice]) || 0;
      var actualPrice = row[itemsIdx.ActualPrice] !== '' ? Number(row[itemsIdx.ActualPrice]) : null;
      var qtyOrdered = Number(row[itemsIdx.QtyOrdered]) || 0;
      var effectivePrice = actualPrice != null ? actualPrice : expectedPrice;
      totalCost += effectivePrice * qtyOrdered;
      items.push({
        id: row[itemsIdx.ID],
        article: row[itemsIdx.Article],
        productName: row[itemsIdx.ProductName],
        qtyOrdered: qtyOrdered,
        qtyReceived: Number(row[itemsIdx.QtyReceived]) || 0,
        expectedPrice: expectedPrice,
        actualPrice: actualPrice
      });
    }

    return ok_({
      id: orderRow[idx.ID],
      supplier: orderRow[idx.Supplier],
      supplierId: orderRow[idx.SupplierId] || '',
      status: orderRow[idx.Status],
      orderDate: orderRow[idx.OrderDate],
      expectedDeliveryDate: orderRow[idx.ExpectedDeliveryDate],
      invoiceFileUrl: orderRow[idx.InvoiceFileUrl],
      invoiceFileName: orderRow[idx.InvoiceFileName],
      comment: orderRow[idx.Comment],
      sourceCustomerOrderId: orderRow[idx.SourceCustomerOrderID] || '',
      totalCostEur: round2_(totalCost),
      items: items
    });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * payload = { supplier, expectedDeliveryDate, comment,
 *   items: [{article, qtyOrdered}, ...],
 *   invoiceBase64, invoiceMimeType, invoiceFileName }
 */
function createPurchaseOrder(token, payload) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    if (!payload.items || !payload.items.length) return fail_('Додайте хоча б одну позицію.');

    var ss = getDb_();
    var productsSheet = ss.getSheetByName(SHEET_PRODUCTS);
    var productsData = productsSheet.getDataRange().getValues();
    var productsIdx = indexMap_(productsData[0]);
    var namesByArticle = {};
    for (var p = 1; p < productsData.length; p++) {
      if (productsData[p][productsIdx.Article]) namesByArticle[String(productsData[p][productsIdx.Article]).toLowerCase()] = productsData[p][productsIdx.Name];
    }

    var invoiceUrl = '', invoiceFileName = '';
    if (payload.invoiceBase64) {
      try {
        var folder = getInvoicesFolder_();
        var bytes = Utilities.base64Decode(payload.invoiceBase64);
        var fileName = payload.invoiceFileName || 'nakladna.pdf';
        var blob = Utilities.newBlob(bytes, payload.invoiceMimeType || 'application/pdf', fileName);
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        invoiceUrl = file.getUrl();
        invoiceFileName = fileName;
      } catch (fileErr) {
        // не блокуємо створення замовлення через збій завантаження накладної
      }
    }

    var id = newId_();
    var sheet = ss.getSheetByName(SHEET_PURCHASE_ORDERS);
    sheet.appendRow([
      id, payload.supplier || '', payload.supplierId || '', 'ordered', nowStr_(), payload.expectedDeliveryDate || '',
      invoiceUrl, invoiceFileName, payload.comment || '', user.fullName || user.login, nowStr_(), payload.sourceCustomerOrderId || ''
    ]);

    var itemsSheet = ss.getSheetByName(SHEET_PURCHASE_ORDER_ITEMS);
    var totalQty = 0;
    payload.items.forEach(function (it) {
      var article = String(it.article || '').trim();
      var qty = Number(it.qtyOrdered) || 0;
      if (!article || !qty) return;
      totalQty += qty;
      itemsSheet.appendRow([newId_(), id, article, it.name || namesByArticle[article.toLowerCase()] || '', qty, 0, Number(it.expectedPrice) || 0, '']);
    });

    logHistory_(user, 'Замовлення постачальнику', '', payload.supplier || '', totalQty,
      payload.items.length + ' позицій' + (payload.supplier ? ', постачальник: ' + payload.supplier : ''));
    return ok_({ id: id });
  } catch (e) {
    return fail_(e.message);
  }
}

function getInvoicesFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('INVOICES_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  var folder = DriveApp.createFolder('SHSklad_Invoices');
  props.setProperty('INVOICES_FOLDER_ID', folder.getId());
  return folder;
}

function updatePurchaseOrderStatus(token, orderId, newStatus) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var sheet = getDb_().getSheetByName(SHEET_PURCHASE_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === orderId) {
        sheet.getRange(i + 1, idx.Status + 1).setValue(newStatus);
        logHistory_(user, 'Статус замовлення змінено', '', data[i][idx.Supplier], 0, 'Новий статус: ' + newStatus);
        return ok_(true);
      }
    }
    return fail_('Замовлення не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}

function deletePurchaseOrder(token, orderId) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_PURCHASE_ORDERS);
    var data = sheet.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === orderId) { sheet.deleteRow(i + 1); found = true; break; }
    }
    if (!found) return fail_('Замовлення не знайдено.');

    var itemsSheet = ss.getSheetByName(SHEET_PURCHASE_ORDER_ITEMS);
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
 * Прихід прямо з картки замовлення — не треба йти шукати товари окремо.
 * receivedItems = [{ article, qty }] — фактично отримана кількість по кожній позиції.
 * Оновлює QtyReceived замовлення, реально поповнює склад (як звичайний прихід),
 * і якщо все замовлене вже отримано — сам переводить статус у "delivered".
 */
function receiveFromPurchaseOrder(token, orderId, receivedItems, warehouseId) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    if (!receivedItems || !receivedItems.length) return fail_('Вкажіть отриману кількість або скориговану ціну хоча б по одній позиції.');

    var bulkRows = receivedItems
      .filter(function (r) { return Number(r.qty) > 0; })
      .map(function (r) { return { article: r.article, qty: r.qty, comment: 'Прихід за замовленням постачальнику' }; });

    var receiveResult = { success: [] };
    if (bulkRows.length) {
      receiveResult = bulkReceiveStock(token, bulkRows, warehouseId);
      if (!receiveResult.success) return receiveResult;
    }

    // Оновлюємо QtyReceived по позиціях замовлення + перевіряємо, чи все отримано.
    var ss = getDb_();
    var itemsSheet = ss.getSheetByName(SHEET_PURCHASE_ORDER_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsIdx = indexMap_(itemsData[0]);

    var receivedByArticle = {};
    var actualPriceByArticle = {};
    receivedItems.forEach(function (r) {
      receivedByArticle[String(r.article).toLowerCase()] = Number(r.qty) || 0;
      if (r.actualPrice !== undefined && r.actualPrice !== null && r.actualPrice !== '') {
        actualPriceByArticle[String(r.article).toLowerCase()] = Number(r.actualPrice) || 0;
      }
    });

    var allReceived = true;
    for (var i = 1; i < itemsData.length; i++) {
      var row = itemsData[i];
      if (row[itemsIdx.PurchaseOrderID] !== orderId) continue;
      var articleLower = String(row[itemsIdx.Article]).toLowerCase();
      var extra = receivedByArticle[articleLower] || 0;
      var newReceived = (Number(row[itemsIdx.QtyReceived]) || 0) + extra;
      itemsSheet.getRange(i + 1, itemsIdx.QtyReceived + 1).setValue(newReceived);
      // Фактична ціна при отриманні могла відрізнятись від очікуваної —
      // зберігаємо, щоб вартість цього замовлення рахувалась по факту.
      if (actualPriceByArticle.hasOwnProperty(articleLower)) {
        itemsSheet.getRange(i + 1, itemsIdx.ActualPrice + 1).setValue(actualPriceByArticle[articleLower]);
      }
      if (newReceived < (Number(row[itemsIdx.QtyOrdered]) || 0)) allReceived = false;
    }

    var poSheet = ss.getSheetByName(SHEET_PURCHASE_ORDERS);
    var poData = poSheet.getDataRange().getValues();
    var poIdx = indexMap_(poData[0]);
    for (var j = 1; j < poData.length; j++) {
      if (poData[j][poIdx.ID] === orderId) {
        poSheet.getRange(j + 1, poIdx.Status + 1).setValue(allReceived ? 'delivered' : 'partial');
        break;
      }
    }

    return ok_({ success: receiveResult.data.success, errors: receiveResult.data.errors, allReceived: allReceived });
  } catch (e) {
    return fail_(e.message);
  }
}
