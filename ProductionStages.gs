/**
 * ProductionStages.gs — етапи виробництва.
 *
 * Адмін налаштовує список етапів (наприклад: Розкрій → Зварювання → Фарбування).
 * Кожне заплановане замовлення на виробництво проходить ці етапи як прогрес-бар —
 * це НЕ впливає на резервування/списання складу (те лишається як є), просто дає
 * видимість "на якому етапі зараз знаходиться виріб".
 */

function listProductionStages(token) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTION_STAGES);
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

function saveProductionStages(token, stageNames) {
  try {
    requireRole_(token, ['admin']);
    if (!stageNames || !stageNames.length) return fail_('Додайте хоча б один етап.');
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTION_STAGES);
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 3).clearContent();
    stageNames.forEach(function (name, i) {
      sheet.getRange(i + 2, 1, 1, 3).setValues([[newId_(), name, i]]);
    });
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Перевести замовлення на наступний етап (або конкретний за номером).
 */
function advanceProductionStage(token, orderId, newStageIndex) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    var sheet = getDb_().getSheetByName(SHEET_PRODUCTION_ORDERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === orderId) {
        var history = [];
        try { history = JSON.parse(data[i][idx.StageHistoryJson] || '[]'); } catch (e) {}
        history.push({ stageIndex: newStageIndex, user: user.fullName || user.login, at: nowStr_() });

        sheet.getRange(i + 1, idx.CurrentStageIndex + 1).setValue(newStageIndex);
        sheet.getRange(i + 1, idx.StageHistoryJson + 1).setValue(JSON.stringify(history));

        // Якщо це останній налаштований етап — виробництво фізично завершено.
        var stagesSheet = getDb_().getSheetByName(SHEET_PRODUCTION_STAGES);
        var stagesCount = stagesSheet.getDataRange().getValues().length - 1;
        if (newStageIndex >= stagesCount - 1 && data[i][idx.Status] === 'in_progress') {
          sheet.getRange(i + 1, idx.Status + 1).setValue('completed');
          sheet.getRange(i + 1, idx.CompletedAt + 1).setValue(nowStr_());
        }

        logHistory_(user, 'Етап виробництва змінено', '', data[i][idx.AssemblyName], 0, 'Новий етап: #' + newStageIndex);
        return ok_(true);
      }
    }
    return fail_('Замовлення не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}
