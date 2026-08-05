/**
 * Employees.gs — картки працівників.
 */

function listEmployees(token, includeInactive) {
  try {
    requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_EMPLOYEES);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var list = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      if (!includeInactive && row[idx.Status] === 'inactive') continue;
      list.push({
        id: row[idx.ID], fullName: row[idx.FullName], position: row[idx.Position],
        phone: row[idx.Phone], photoUrl: row[idx.PhotoUrl], hireDate: row[idx.HireDate],
        status: row[idx.Status], notes: row[idx.Notes]
      });
    }
    list.sort(function (a, b) { return String(a.fullName || '').localeCompare(String(b.fullName || '')); });
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

function saveEmployee(token, employeeId, payload) {
  try {
    requireRole_(token, ['admin']);
    if (!payload.fullName) return fail_('Вкажіть ПІБ.');

    var sheet = getDb_().getSheetByName(SHEET_EMPLOYEES);
    if (employeeId) {
      var data = sheet.getDataRange().getValues();
      var idx = indexMap_(data[0]);
      for (var i = 1; i < data.length; i++) {
        if (data[i][idx.ID] === employeeId) {
          sheet.getRange(i + 1, idx.FullName + 1).setValue(payload.fullName);
          sheet.getRange(i + 1, idx.Position + 1).setValue(payload.position || '');
          sheet.getRange(i + 1, idx.Phone + 1).setValue(payload.phone || '');
          sheet.getRange(i + 1, idx.Status + 1).setValue(payload.status || 'active');
          sheet.getRange(i + 1, idx.Notes + 1).setValue(payload.notes || '');
          if (payload.hireDate) sheet.getRange(i + 1, idx.HireDate + 1).setValue(payload.hireDate);
          return ok_({ id: employeeId });
        }
      }
      return fail_('Працівника не знайдено.');
    }

    var id = newId_();
    sheet.appendRow([id, payload.fullName, payload.position || '', payload.phone || '', '', payload.hireDate || nowStr_(), 'active', payload.notes || '']);
    return ok_({ id: id });
  } catch (e) {
    return fail_(e.message);
  }
}

function uploadEmployeePhoto(token, employeeId, base64, mimeType, fileName) {
  try {
    requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_EMPLOYEES);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === employeeId) {
        var folder = getPhotosFolder_();
        var bytes = Utilities.base64Decode(base64);
        var blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', fileName || 'employee.jpg');
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
        sheet.getRange(i + 1, idx.PhotoUrl + 1).setValue(url);
        return ok_({ url: url });
      }
    }
    return fail_('Працівника не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteEmployee(token, employeeId) {
  try {
    requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_EMPLOYEES);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === employeeId) {
        // Не видаляємо фізично (щоб не втратити історію нарахувань) — просто деактивуємо.
        var idx = indexMap_(data[0]);
        sheet.getRange(i + 1, idx.Status + 1).setValue('inactive');
        return ok_(true);
      }
    }
    return fail_('Не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}
