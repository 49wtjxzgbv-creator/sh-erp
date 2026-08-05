/**
 * Automation.gs — проста автоматизація: щоденна перевірка залишків нижче
 * мінімуму, з надсиланням короткого підсумку на пошту. Використовує звичайний
 * тригер за часом Apps Script (не потребує зовнішніх сервісів).
 */

function installDailyDigestTrigger(token, email) {
  try {
    requireRole_(token, ['admin']);
    if (!email || email.indexOf('@') === -1) return fail_('Вкажіть коректну електронну пошту.');

    // Прибираємо старий тригер, якщо був, щоб не задвоївся.
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'dailyLowStockDigest_') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('dailyLowStockDigest_').timeBased().everyDays(1).atHour(8).create();

    var sheet = getDb_().getSheetByName(SHEET_SETTINGS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.Key] === 'DailyDigestEmail') { sheet.getRange(i + 1, idx.Value + 1).setValue(email); found = true; break; }
    }
    if (!found) sheet.appendRow(['DailyDigestEmail', email]);

    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

function removeDailyDigestTrigger(token) {
  try {
    requireRole_(token, ['admin']);
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'dailyLowStockDigest_') ScriptApp.deleteTrigger(t);
    });
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

function getDailyDigestStatus(token) {
  try {
    requireRole_(token, ['admin']);
    var sheet = getDb_().getSheetByName(SHEET_SETTINGS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var email = '';
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.Key] === 'DailyDigestEmail') { email = data[i][idx.Value]; break; }
    }
    var installed = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyLowStockDigest_'; });
    return ok_({ installed: installed, email: email });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Викликається автоматично тригером за часом (не через API_WHITELIST_,
 * бо запускається самим Apps Script, не через doPost).
 */
function dailyLowStockDigest_() {
  var props = PropertiesService.getScriptProperties();
  var sheet = getDb_().getSheetByName(SHEET_SETTINGS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  var email = '';
  for (var i = 1; i < data.length; i++) {
    if (data[i][idx.Key] === 'DailyDigestEmail') { email = data[i][idx.Value]; break; }
  }
  if (!email) return;

  var lowStock = getLowStockProducts_internal_();
  var forecast = forecastPurchaseNeeds_('').filter(function (f) { return f.daysUntilEmpty <= 14; });

  var body = 'Щоденний підсумок складу SH ERP\n\n';
  body += 'Товарів нижче мінімального залишку: ' + lowStock.length + '\n';
  lowStock.slice(0, 20).forEach(function (p) { body += '- ' + p.article + ' — ' + p.name + ': ' + p.qty + ' (мін. ' + p.minQty + ')\n'; });

  if (forecast.length) {
    body += '\nЗакінчаться протягом 14 днів (за темпом витрати):\n';
    forecast.forEach(function (f) { body += '- ' + f.article + ' — ' + f.name + ': закінчиться через ' + f.daysUntilEmpty + ' дн., варто замовити ~' + f.suggestedOrderQty + '\n'; });
  }

  if (!lowStock.length && !forecast.length) body += 'Усе в нормі, критичних залишків немає.';

  MailApp.sendEmail(email, 'SH ERP — щоденний підсумок складу', body);

  // Бонус: та сама інформація в Telegram, якщо бот налаштований і є прив'язані
  // адміни — не блокує й не залежить від успіху надсилання email вище.
  try {
    tgNotifyAdmins_('📊 ' + body);
  } catch (tgErr) {
    Logger.log('dailyLowStockDigest_ telegram error: ' + tgErr.message);
  }
}
