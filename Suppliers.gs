function listSuppliers(token) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_SUPPLIERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var list = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][idx.ID]) continue;
      list.push({
        id: data[i][idx.ID],
        name: data[i][idx.Name],
        contactPerson: data[i][idx.ContactPerson] || '',
        phone: data[i][idx.Phone] || '',
        email: data[i][idx.Email] || '',
        notes: data[i][idx.Notes] || ''
      });
    }
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

function saveSupplier(token, supplierId, payload) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    if (!payload.name || !payload.name.trim()) return fail_('Вкажіть назву постачальника.');

    var sheet = getDb_().getSheetByName(SHEET_SUPPLIERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    if (supplierId) {
      var found = false;
      for (var i = 1; i < data.length; i++) {
        if (data[i][idx.ID] === supplierId) {
          sheet.getRange(i + 1, idx.Name + 1).setValue(payload.name.trim());
          sheet.getRange(i + 1, idx.ContactPerson + 1).setValue(payload.contactPerson || '');
          sheet.getRange(i + 1, idx.Phone + 1).setValue(payload.phone || '');
          sheet.getRange(i + 1, idx.Email + 1).setValue(payload.email || '');
          sheet.getRange(i + 1, idx.Notes + 1).setValue(payload.notes || '');
          found = true;
          break;
        }
      }
      if (!found) return fail_('Постачальника не знайдено.');
      return ok_({ id: supplierId });
    } else {
      var id = newId_();
      sheet.appendRow([id, payload.name.trim(), payload.contactPerson || '', payload.phone || '', payload.email || '', payload.notes || '', nowStr_()]);
      return ok_({ id: id });
    }
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteSupplier(token, supplierId) {
  try {
    requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_SUPPLIERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === supplierId) {
        sheet.deleteRow(i + 1);
        return ok_(true);
      }
    }
    return fail_('Постачальника не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}
