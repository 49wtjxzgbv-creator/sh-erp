/**
 * QualityControl.gs — контроль якості готових виробів.
 */

function listQCChecklist(token) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_QC_CHECKLIST);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var list = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][idx.ID]) continue;
      list.push({ id: data[i][idx.ID], name: data[i][idx.Name], sortOrder: Number(data[i][idx.SortOrder]) || 0 });
    }
    list.sort(function (a, b) { return a.sortOrder - b.sortOrder; });
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

function saveQCChecklist(token, itemNames) {
  try {
    requireRole_(token, ['admin']);
    if (!itemNames || !itemNames.length) return fail_('Додайте хоча б один пункт перевірки.');
    var sheet = getDb_().getSheetByName(SHEET_QC_CHECKLIST);
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 3).clearContent();
    itemNames.forEach(function (name, i) {
      sheet.getRange(i + 2, 1, 1, 3).setValues([[newId_(), name, i]]);
    });
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * checklistResults = [{ item, passed }], result = 'accepted' | 'rework'
 */
function performQualityCheck(token, finishedGoodId, checklistResults, result, comment, photoBase64, photoMimeType) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    if (result !== 'accepted' && result !== 'rework') return fail_('Некоректний результат перевірки.');

    var ss = getDb_();
    var fgSheet = ss.getSheetByName(SHEET_FINISHED_GOODS);
    var fgData = fgSheet.getDataRange().getValues();
    var fgIdx = indexMap_(fgData[0]);
    var serialNumber = '', fgRowNum = null;
    for (var i = 1; i < fgData.length; i++) {
      if (fgData[i][fgIdx.ID] === finishedGoodId) { serialNumber = fgData[i][fgIdx.SerialNumber]; fgRowNum = i + 1; break; }
    }
    if (!fgRowNum) return fail_('Готовий виріб не знайдено.');

    var photoUrl = '';
    if (photoBase64) {
      try {
        var folder = getPhotosFolder_();
        var bytes = Utilities.base64Decode(photoBase64);
        var blob = Utilities.newBlob(bytes, photoMimeType || 'image/jpeg', serialNumber + '.jpg');
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        photoUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
      } catch (e) {}
    }

    var qcSheet = ss.getSheetByName(SHEET_QC_CHECKS);
    var id = newId_();
    qcSheet.appendRow([
      id, finishedGoodId, serialNumber, JSON.stringify(checklistResults || []), photoUrl,
      result, user.fullName || user.login, nowStr_(), comment || ''
    ]);

    // Статус готового виробу: rework -> "на доопрацюванні", accepted -> лишається/повертається "на складі".
    fgSheet.getRange(fgRowNum, fgIdx.Status + 1).setValue(result === 'accepted' ? 'in_stock' : 'rework');

    logHistory_(user, 'Контроль якості', '', serialNumber, 0, result === 'accepted' ? 'Прийнято' : 'Повернуто на доопрацювання');
    return ok_({ id: id });
  } catch (e) {
    return fail_(e.message);
  }
}

function listQualityChecks(token, filters) {
  try {
    requireAuth_(token);
    filters = filters || {};
    var sheet = getDb_().getSheetByName(SHEET_QC_CHECKS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var list = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      if (filters.result && row[idx.Result] !== filters.result) continue;
      list.push({
        id: row[idx.ID], finishedGoodId: row[idx.FinishedGoodID], serialNumber: row[idx.SerialNumber],
        result: row[idx.Result], inspector: row[idx.Inspector], checkedAt: row[idx.CheckedAt],
        photoUrl: row[idx.PhotoUrl], comment: row[idx.Comment]
      });
    }
    list.reverse();
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

function getQualityCheck(token, id) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_QC_CHECKS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === id) {
        var checklist = [];
        try { checklist = JSON.parse(data[i][idx.ChecklistJson] || '[]'); } catch (e) {}
        return ok_({
          id: data[i][idx.ID], serialNumber: data[i][idx.SerialNumber], checklist: checklist,
          photoUrl: data[i][idx.PhotoUrl], result: data[i][idx.Result],
          inspector: data[i][idx.Inspector], checkedAt: data[i][idx.CheckedAt], comment: data[i][idx.Comment]
        });
      }
    }
    return fail_('Перевірку не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}
