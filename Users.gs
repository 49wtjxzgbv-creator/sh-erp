/**
 * Users.gs — управління користувачами. Доступно лише ролі "admin".
 */

function listUsers(token) {
  try {
    requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_USERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var users = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[idx.ID]) continue;
      users.push({
        id: row[idx.ID],
        login: row[idx.Login],
        role: row[idx.Role],
        fullName: row[idx.FullName],
        active: row[idx.Active],
        createdAt: row[idx.CreatedAt]
      });
    }
    return ok_(users);
  } catch (e) {
    return fail_(e.message);
  }
}

function createUser(token, payload) {
  try {
    requireRole_(token, ['admin']);
    if (!payload.login || !payload.password || !payload.role) {
      return fail_('Заповніть логін, пароль та роль.');
    }
    if (['admin', 'storekeeper', 'viewer'].indexOf(payload.role) === -1) {
      return fail_('Невірна роль.');
    }

    var sheet = getDb_().getSheetByName(SHEET_USERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idx.Login]).toLowerCase() === String(payload.login).toLowerCase()) {
        return fail_('Користувач з таким логіном вже існує.');
      }
    }

    var id = newId_();
    sheet.appendRow([
      id, payload.login, hashPassword_(payload.password), payload.role,
      payload.fullName || '', true, nowStr_()
    ]);
    return ok_({ id: id });
  } catch (e) {
    return fail_(e.message);
  }
}

function updateUser(token, userId, payload) {
  try {
    requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_USERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === userId) {
        var rowNum = i + 1;
        if (payload.fullName !== undefined) sheet.getRange(rowNum, idx.FullName + 1).setValue(payload.fullName);
        if (payload.role !== undefined) sheet.getRange(rowNum, idx.Role + 1).setValue(payload.role);
        if (payload.active !== undefined) sheet.getRange(rowNum, idx.Active + 1).setValue(payload.active);
        if (payload.password) sheet.getRange(rowNum, idx.PasswordHash + 1).setValue(hashPassword_(payload.password));
        return ok_(true);
      }
    }
    return fail_('Користувача не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteUser(token, userId) {
  try {
    var actingUser = requireRole_(token, ['admin']);
    if (actingUser.id === userId) return fail_('Не можна видалити власний обліковий запис.');

    var sheet = getDb_().getSheetByName(SHEET_USERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === userId) {
        sheet.deleteRow(i + 1);
        return ok_(true);
      }
    }
    return fail_('Користувача не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}
