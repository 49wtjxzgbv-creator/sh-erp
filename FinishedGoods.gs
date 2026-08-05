/**
 * FinishedGoods.gs — готові вироби із серійними номерами.
 *
 * Коли виробниче замовлення запускається (startProductionOrder), окрім
 * списання компонентів тепер ще створюється по ОДНОМУ запису тут на кожну
 * фізичну одиницю виробу — з унікальним серійним номером. Це дає змогу
 * пізніше знайти будь-який конкретний виріб і побачити його повну історію:
 * коли зроблено, з якого замовлення, які компоненти використано.
 */

/**
 * Списує КОНКРЕТНІ готові одиниці виробу (найстаріші спершу — FIFO) як
 * компонент вищого виробу. Позначає їх статусом "consumed" і зберігає
 * посилання на те замовлення, до складу якого вони увійшли — повна
 * трасованість "який серійний номер пішов у який виріб".
 */
function consumeFinishedGoods_(subAssemblyId, qtyNeeded, consumingProductionOrderId) {
  var sheet = getDb_().getSheetByName(SHEET_FINISHED_GOODS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);

  var candidates = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[idx.AssemblyID] === subAssemblyId && row[idx.Status] === 'in_stock') {
      candidates.push({ rowNum: i + 1, serial: row[idx.SerialNumber], costLocal: Number(row[idx.UnitCostLocalEur]) || 0, costGerman: Number(row[idx.UnitCostGermanEur]) || 0, manufactureDate: row[idx.ManufactureDate] });
    }
  }
  candidates.sort(function (a, b) { return new Date(a.manufactureDate) - new Date(b.manufactureDate); }); // FIFO

  var toConsume = candidates.slice(0, qtyNeeded);
  var serials = [], totalCostLocal = 0, totalCostGerman = 0;
  toConsume.forEach(function (item) {
    sheet.getRange(item.rowNum, idx.Status + 1).setValue('consumed');
    sheet.getRange(item.rowNum, idx.ConsumedInProductionOrderID + 1).setValue(consumingProductionOrderId);
    serials.push(item.serial);
    totalCostLocal += item.costLocal;
    totalCostGerman += item.costGerman;
  });

  return { serials: serials, totalCostLocal: round2_(totalCostLocal), totalCostGerman: round2_(totalCostGerman) };
}

function generateSerialNumber_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var next = Number(props.getProperty('NEXT_SERIAL_NUMBER') || '1');
    props.setProperty('NEXT_SERIAL_NUMBER', String(next + 1));
    return 'SN-' + String(next).padStart(6, '0');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Викликається зсередини startProductionOrder — створює по одному запису
 * готового виробу на кожну виготовлену одиницю.
 */
function createFinishedGoods_(assemblyId, assemblyName, productionOrderId, unitsCount, customerOrderId, unitCostLocal, unitCostGerman) {
  var sheet = getDb_().getSheetByName(SHEET_FINISHED_GOODS);
  var now = nowStr_();
  var serials = [];
  for (var i = 0; i < unitsCount; i++) {
    var serial = generateSerialNumber_();
    sheet.appendRow([
      newId_(), serial, assemblyId, assemblyName, productionOrderId, now, 'in_stock', customerOrderId || '', '',
      round2_(unitCostLocal || 0), round2_(unitCostGerman || 0), ''
    ]);
    serials.push(serial);
  }
  return serials;
}

function listFinishedGoods(token, filters) {
  try {
    requireAuth_(token);
    filters = filters || {};
    var sheet = getDb_().getSheetByName(SHEET_FINISHED_GOODS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var q = String(filters.search || '').toLowerCase();
    var list = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      if (filters.assemblyId && row[idx.AssemblyID] !== filters.assemblyId) continue;
      if (filters.status && row[idx.Status] !== filters.status) continue;
      if (q && String(row[idx.SerialNumber]).toLowerCase().indexOf(q) === -1 &&
        String(row[idx.AssemblyName]).toLowerCase().indexOf(q) === -1) continue;

      list.push({
        id: row[idx.ID],
        serialNumber: row[idx.SerialNumber],
        assemblyId: row[idx.AssemblyID],
        assemblyName: row[idx.AssemblyName],
        productionOrderId: row[idx.ProductionOrderID],
        manufactureDate: row[idx.ManufactureDate],
        status: row[idx.Status],
        customerOrderId: row[idx.CustomerOrderID]
      });
    }
    list.reverse();
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Повна історія конкретного виробу за серійним номером: коли зроблено,
 * з якого виробничого замовлення, які компоненти використано, для якого
 * клієнта (якщо є зв'язок).
 */
function getFinishedGoodBySerial(token, serial) {
  try {
    requireAuth_(token);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_FINISHED_GOODS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var found = null;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idx.SerialNumber]).toLowerCase() === String(serial || '').trim().toLowerCase()) { found = data[i]; break; }
    }
    if (!found) return fail_('Виріб із таким серійним номером не знайдено.');

    var result = {
      id: found[idx.ID],
      serialNumber: found[idx.SerialNumber],
      assemblyName: found[idx.AssemblyName],
      manufactureDate: found[idx.ManufactureDate],
      status: found[idx.Status],
      comment: found[idx.Comment]
    };

    // Якщо цю одиницю вже використано як компонент ІНШОГО (вищого) виробу —
    // показуємо, у складі якого саме замовлення вона тепер.
    var consumedInId = found[idx.ConsumedInProductionOrderID];
    if (consumedInId) {
      var prodSheet2 = ss.getSheetByName(SHEET_PRODUCTION_ORDERS);
      var prodData2 = prodSheet2.getDataRange().getValues();
      var prodIdx2 = indexMap_(prodData2[0]);
      for (var pp = 1; pp < prodData2.length; pp++) {
        if (prodData2[pp][prodIdx2.ID] === consumedInId) {
          result.consumedIntoAssemblyName = prodData2[pp][prodIdx2.AssemblyName];
          break;
        }
      }
    }

    // Компоненти й собівартість — з пов'язаного виробничого замовлення.
    var prodId = found[idx.ProductionOrderID];
    if (prodId) {
      var prodSheet = ss.getSheetByName(SHEET_PRODUCTION_ORDERS);
      var prodData = prodSheet.getDataRange().getValues();
      var prodIdx = indexMap_(prodData[0]);
      for (var p = 1; p < prodData.length; p++) {
        if (prodData[p][prodIdx.ID] === prodId) {
          result.productionOrderId = prodId;
          result.unitsInThatOrder = Number(prodData[p][prodIdx.UnitsPlanned]) || 0;
          result.orderedBy = prodData[p][prodIdx.User];
          try { result.componentsUsed = JSON.parse(prodData[p][prodIdx.PickListJson] || '[]'); } catch (e) { result.componentsUsed = []; }
          break;
        }
      }
    }

    // Клієнт, якщо виріб пов'язаний із замовленням клієнта.
    var coId = found[idx.CustomerOrderID];
    if (coId) {
      var coSheet = ss.getSheetByName(SHEET_CUSTOMER_ORDERS);
      var coData = coSheet.getDataRange().getValues();
      var coIdx = indexMap_(coData[0]);
      for (var c = 1; c < coData.length; c++) {
        if (coData[c][coIdx.ID] === coId) {
          result.customerName = coData[c][coIdx.ClientName];
          result.customerOrderNumber = coData[c][coIdx.OrderNumber];
          break;
        }
      }
    }

    return ok_(result);
  } catch (e) {
    return fail_(e.message);
  }
}

function updateFinishedGoodStatus(token, id, newStatus, comment) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var sheet = getDb_().getSheetByName(SHEET_FINISHED_GOODS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === id) {
        sheet.getRange(i + 1, idx.Status + 1).setValue(newStatus);
        if (comment) sheet.getRange(i + 1, idx.Comment + 1).setValue(comment);
        logHistory_(user, 'Статус готового виробу змінено', '', data[i][idx.SerialNumber], 0, 'Новий статус: ' + newStatus);
        return ok_(true);
      }
    }
    return fail_('Виріб не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}
