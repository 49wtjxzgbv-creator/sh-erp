/**
 * Payroll.gs — відрядна зарплата.
 *
 * Заробіток за виріб нараховується АВТОМАТИЧНО в момент запуску виробничого
 * замовлення (startProductionOrder) — ставка з виробу ділиться між
 * призначеними працівниками за відсотками. Аванси/премії/штрафи додаються
 * вручну. Період (наприклад, місяць) рахується як сума всього цього.
 */

/**
 * Внутрішній хелпер — викликається з startProductionOrder.
 * normalizedWorkers = [{employeeId, percent}], відсотки вже нормалізовані до суми 100.
 */
function createPayrollEntriesForOrder_(productionOrderId, assemblyName, unitsProduced, totalLaborCost, normalizedWorkers, user) {
  var sheet = getDb_().getSheetByName(SHEET_PAYROLL_ENTRIES);
  var now = nowStr_();
  normalizedWorkers.forEach(function (w) {
    if (!w.employeeId) return;
    var amount = round2_(totalLaborCost * w.percent / 100);
    sheet.appendRow([
      newId_(), w.employeeId, 'piecework', productionOrderId, assemblyName, unitsProduced,
      amount, now, 'Частка: ' + w.percent + '%', user.fullName || user.login, now
    ]);
  });
}

/**
 * Ручне нарахування: аванс, премія, штраф. Аванс і штраф зберігаються як
 * ВІД'ЄМНА сума (зменшують те, що лишилось виплатити), премія — додатна.
 */
function addPayrollEntry(token, employeeId, type, amount, comment) {
  try {
    var user = requireRole_(token, ['admin']);
    if (['advance', 'bonus', 'penalty'].indexOf(type) === -1) return fail_('Некоректний тип нарахування.');
    amount = Math.abs(Number(amount) || 0);
    if (!amount) return fail_('Вкажіть суму.');
    if (type === 'advance' || type === 'penalty') amount = -amount;

    var sheet = getDb_().getSheetByName(SHEET_PAYROLL_ENTRIES);
    var id = newId_();
    var now = nowStr_();
    sheet.appendRow([id, employeeId, type, '', '', '', amount, now, comment || '', user.fullName || user.login, now]);

    var typeLabels = { advance: 'Аванс', bonus: 'Премія', penalty: 'Штраф' };
    logHistory_(user, typeLabels[type], '', '', amount, comment || '');
    return ok_({ id: id });
  } catch (e) {
    return fail_(e.message);
  }
}

function deletePayrollEntry(token, entryId) {
  try {
    requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_PAYROLL_ENTRIES);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === entryId) { sheet.deleteRow(i + 1); return ok_(true); }
    }
    return fail_('Запис не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}

var PAYROLL_TYPE_LABELS_ = { piecework: 'Відрядна оплата', advance: 'Аванс', bonus: 'Премія', penalty: 'Штраф' };

/**
 * Повний журнал нарахувань конкретного працівника за період (або весь час,
 * якщо дати не вказані) + підсумок до виплати.
 */
function getEmployeePayroll(token, employeeId, dateFrom, dateTo) {
  try {
    requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_PAYROLL_ENTRIES);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var from = dateFrom ? new Date(dateFrom) : null;
    var to = dateTo ? new Date(dateTo) : null;

    var entries = [];
    var total = 0, earned = 0, bonuses = 0, penalties = 0, advances = 0, unitsTotal = 0;
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[idx.EmployeeID] !== employeeId) continue;
      var entryDate = new Date(row[idx.EntryDate]);
      if (from && entryDate < from) continue;
      if (to && entryDate > to) continue;

      var amount = Number(row[idx.Amount]) || 0;
      var type = row[idx.Type];
      total += amount;
      if (type === 'piecework') { earned += amount; unitsTotal += Number(row[idx.UnitsProduced]) || 0; }
      if (type === 'bonus') bonuses += amount;
      if (type === 'penalty') penalties += amount;
      if (type === 'advance') advances += amount;

      entries.push({
        id: row[idx.ID], type: type, typeLabel: PAYROLL_TYPE_LABELS_[type] || type,
        assemblyName: row[idx.AssemblyName], unitsProduced: row[idx.UnitsProduced],
        amount: amount, entryDate: row[idx.EntryDate], comment: row[idx.Comment]
      });
    }
    entries.reverse();

    return ok_({
      entries: entries,
      totals: { total: round2_(total), earned: round2_(earned), bonuses: round2_(bonuses), penalties: round2_(penalties), advances: round2_(advances), units: unitsTotal }
    });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Зведення по ВСІХ працівниках за період — і є він же KPI: одиниць,
 * заробіток, кількість браку (з контролю якості по замовленнях, де
 * працівник був призначений).
 */
function getPayrollSummaryReport(token, dateFrom, dateTo) {
  try {
    requireRole_(token, ['admin']);
    var ss = getDb_();

    var empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
    var empData = empSheet.getDataRange().getValues();
    var empIdx = indexMap_(empData[0]);
    var employees = {};
    for (var e = 1; e < empData.length; e++) {
      if (empData[e][empIdx.ID]) employees[empData[e][empIdx.ID]] = { id: empData[e][empIdx.ID], fullName: empData[e][empIdx.FullName] };
    }

    var sheet = ss.getSheetByName(SHEET_PAYROLL_ENTRIES);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var from = dateFrom ? new Date(dateFrom) : null;
    var to = dateTo ? new Date(dateTo) : null;

    var summary = {};
    Object.keys(employees).forEach(function (id) {
      summary[id] = { employeeId: id, fullName: employees[id].fullName, earned: 0, bonuses: 0, penalties: 0, advances: 0, total: 0, units: 0, orderIds: [] };
    });

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var empId = row[idx.EmployeeID];
      if (!summary[empId]) continue; // працівника видалено/неактивний і не в списку — пропускаємо
      var entryDate = new Date(row[idx.EntryDate]);
      if (from && entryDate < from) continue;
      if (to && entryDate > to) continue;

      var amount = Number(row[idx.Amount]) || 0;
      var type = row[idx.Type];
      var s = summary[empId];
      s.total += amount;
      if (type === 'piecework') { s.earned += amount; s.units += Number(row[idx.UnitsProduced]) || 0; if (row[idx.ProductionOrderID]) s.orderIds.push(row[idx.ProductionOrderID]); }
      if (type === 'bonus') s.bonuses += amount;
      if (type === 'penalty') s.penalties += amount;
      if (type === 'advance') s.advances += amount;
    }

    // Брак: рахуємо через QC-перевірки з результатом "rework" по готових
    // виробах, чиє виробниче замовлення входить у orderIds цього працівника.
    var qcSheet = ss.getSheetByName(SHEET_QC_CHECKS);
    var qcData = qcSheet.getDataRange().getValues();
    var qcIdx = indexMap_(qcData[0]);
    var fgSheet = ss.getSheetByName(SHEET_FINISHED_GOODS);
    var fgData = fgSheet.getDataRange().getValues();
    var fgIdx = indexMap_(fgData[0]);
    var orderIdByFgId = {};
    for (var f = 1; f < fgData.length; f++) {
      if (fgData[f][fgIdx.ID]) orderIdByFgId[fgData[f][fgIdx.ID]] = fgData[f][fgIdx.ProductionOrderID];
    }
    var reworkCountByOrder = {};
    for (var q = 1; q < qcData.length; q++) {
      if (qcData[q][qcIdx.Result] !== 'rework') continue;
      var ordId = orderIdByFgId[qcData[q][qcIdx.FinishedGoodID]];
      if (ordId) reworkCountByOrder[ordId] = (reworkCountByOrder[ordId] || 0) + 1;
    }

    var result = Object.keys(summary).map(function (id) {
      var s = summary[id];
      var defects = 0;
      s.orderIds.forEach(function (oid) { defects += reworkCountByOrder[oid] || 0; });
      return {
        employeeId: s.employeeId, fullName: s.fullName,
        earned: round2_(s.earned), bonuses: round2_(s.bonuses), penalties: round2_(s.penalties),
        advances: round2_(s.advances), total: round2_(s.total), units: s.units, defects: defects
      };
    });
    result.sort(function (a, b) { return b.total - a.total; });
    return ok_(result);
  } catch (e) {
    return fail_(e.message);
  }
}
