/**
 * Shipments.gs — відвантаження готових виробів.
 */

function listShipments(token, statusFilter) {
  try {
    requireAuth_(token);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_SHIPMENTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var itemsSheet = ss.getSheetByName(SHEET_SHIPMENT_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsIdx = indexMap_(itemsData[0]);
    var itemCounts = {};
    for (var j = 1; j < itemsData.length; j++) {
      var shId = itemsData[j][itemsIdx.ShipmentID];
      if (!shId) continue;
      itemCounts[shId] = (itemCounts[shId] || 0) + 1;
    }

    var list = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      if (statusFilter && row[idx.Status] !== statusFilter) continue;
      list.push({
        id: row[idx.ID], carrier: row[idx.Carrier], waybillNumber: row[idx.WaybillNumber],
        packageCount: row[idx.PackageCount], weight: row[idx.Weight], dimensions: row[idx.Dimensions],
        photoUrl: row[idx.PhotoUrl], shipDate: row[idx.ShipDate], deliveryDate: row[idx.DeliveryDate],
        status: row[idx.Status], comment: row[idx.Comment], itemCount: itemCounts[row[idx.ID]] || 0
      });
    }
    list.reverse();
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

function getShipment(token, shipmentId) {
  try {
    requireAuth_(token);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_SHIPMENTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var row = null;
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === shipmentId) { row = data[i]; break; }
    }
    if (!row) return fail_('Відвантаження не знайдено.');

    var itemsSheet = ss.getSheetByName(SHEET_SHIPMENT_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsIdx = indexMap_(itemsData[0]);
    var items = [];
    for (var j = 1; j < itemsData.length; j++) {
      if (itemsData[j][itemsIdx.ShipmentID] !== shipmentId) continue;
      items.push({ finishedGoodId: itemsData[j][itemsIdx.FinishedGoodID], serialNumber: itemsData[j][itemsIdx.SerialNumber] });
    }

    return ok_({
      id: row[idx.ID], carrier: row[idx.Carrier], waybillNumber: row[idx.WaybillNumber],
      packageCount: row[idx.PackageCount], weight: row[idx.Weight], dimensions: row[idx.Dimensions],
      photoUrl: row[idx.PhotoUrl], shipDate: row[idx.ShipDate], deliveryDate: row[idx.DeliveryDate],
      status: row[idx.Status], comment: row[idx.Comment], items: items
    });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * payload = { carrier, waybillNumber, packageCount, weight, dimensions, shipDate, comment,
 *   serialNumbers: ['SN-000001', ...], photoBase64, photoMimeType }
 */
function createShipment(token, payload) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    if (!payload.serialNumbers || !payload.serialNumbers.length) return fail_('Додайте хоча б один виріб за серійним номером.');

    var ss = getDb_();
    var fgSheet = ss.getSheetByName(SHEET_FINISHED_GOODS);
    var fgData = fgSheet.getDataRange().getValues();
    var fgIdx = indexMap_(fgData[0]);
    var fgBySerial = {};
    for (var i = 1; i < fgData.length; i++) {
      if (fgData[i][fgIdx.SerialNumber]) fgBySerial[String(fgData[i][fgIdx.SerialNumber]).toLowerCase()] = { id: fgData[i][fgIdx.ID], rowNum: i + 1 };
    }

    var notFound = [];
    var validSerials = [];
    payload.serialNumbers.forEach(function (sn) {
      var found = fgBySerial[String(sn).toLowerCase()];
      if (!found) { notFound.push(sn); return; }
      validSerials.push({ serial: sn, fgId: found.id, rowNum: found.rowNum });
    });
    if (notFound.length) return fail_('Не знайдено серійних номерів: ' + notFound.join(', '));

    var photoUrl = '';
    if (payload.photoBase64) {
      try {
        var folder = getPhotosFolder_();
        var bytes = Utilities.base64Decode(payload.photoBase64);
        var blob = Utilities.newBlob(bytes, payload.photoMimeType || 'image/jpeg', 'shipment.jpg');
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        photoUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
      } catch (e) {}
    }

    var id = newId_();
    var sheet = ss.getSheetByName(SHEET_SHIPMENTS);
    sheet.appendRow([
      id, payload.carrier || '', payload.waybillNumber || '', Number(payload.packageCount) || 0,
      Number(payload.weight) || 0, payload.dimensions || '', photoUrl,
      payload.shipDate || nowStr_(), '', 'shipped', payload.customerOrderId || '', payload.comment || '',
      user.fullName || user.login, nowStr_()
    ]);

    var itemsSheet = ss.getSheetByName(SHEET_SHIPMENT_ITEMS);
    validSerials.forEach(function (v) {
      itemsSheet.appendRow([newId_(), id, v.fgId, v.serial]);
      fgSheet.getRange(v.rowNum, fgIdx.Status + 1).setValue('shipped');
    });

    logHistory_(user, 'Відвантаження створено', '', payload.waybillNumber || '', validSerials.length,
      (payload.carrier ? 'Перевізник: ' + payload.carrier : ''));
    return ok_({ id: id });
  } catch (e) {
    return fail_(e.message);
  }
}

function markShipmentDelivered(token, shipmentId, deliveryDate) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var sheet = getDb_().getSheetByName(SHEET_SHIPMENTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === shipmentId) {
        sheet.getRange(i + 1, idx.Status + 1).setValue('delivered');
        sheet.getRange(i + 1, idx.DeliveryDate + 1).setValue(deliveryDate || nowStr_());
        logHistory_(user, 'Відвантаження доставлено', '', data[i][idx.WaybillNumber], 0, '');
        return ok_(true);
      }
    }
    return fail_('Відвантаження не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteShipment(token, shipmentId) {
  try {
    requireRole_(token, ['admin']);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_SHIPMENTS);
    var data = sheet.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === shipmentId) { sheet.deleteRow(i + 1); found = true; break; }
    }
    if (!found) return fail_('Не знайдено.');

    var itemsSheet = ss.getSheetByName(SHEET_SHIPMENT_ITEMS);
    var itemsData = itemsSheet.getDataRange().getValues();
    for (var j = itemsData.length - 1; j >= 1; j--) {
      if (itemsData[j][1] === shipmentId) itemsSheet.deleteRow(j + 1);
    }
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}
