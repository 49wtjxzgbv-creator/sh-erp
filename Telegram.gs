/**
 * Telegram.gs — інтеграція з Telegram-ботом. НЕ залежить від Gemini/AI —
 * усі команди й документи працюють на прямих викликах до вже існуючих
 * серверних функцій (тих самих, що використовує веб-інтерфейс).
 *
 * АРХІТЕКТУРА: ОПИТУВАННЯ (polling), НЕ вебхук.
 * Спроба через вебхук (Telegram сам стукає в doPost застосунку) не
 * запрацювала: Apps Script Web App на POST-запит /exec віддає HTTP 302
 * (внутрішній редирект на googleusercontent.com), а Telegram НЕ йде за
 * редиректами при перевірці відповіді вебхука — тому кожна доставка
 * позначалась як невдала й Telegram нескінченно повторював апдейти
 * ("Wrong response from the webhook: 302 Found"). Це структурна
 * несумісність Apps Script Web App із вимогами Telegram до вебхука, її не
 * обійти зсередини doPost. Замість цього застосунок сам щохвилини
 * запитує в Telegram "чи є нове?" (getUpdates) через звичайний
 * time-driven тригер — той самий підхід, що вже використовується для
 * щоденного дайджесту (Automation.gs).
 *
 * Як це працює:
 * 1. Адмін вставляє токен бота (від @BotFather) у Налаштування → Telegram,
 *    тисне "Увімкнути опитування" — створюється тригер pollTelegramUpdates_,
 *    що раз на хвилину забирає нові повідомлення від Telegram.
 * 2. Будь-який користувач (admin/storekeeper/viewer) пише боту
 *    /login логін пароль — тим самим логіном/паролем, що й у веб-версії.
 *    Прив'язка chatId -> користувач зберігається в аркуші TelegramUsers.
 * 3. /menu показує розділи -> звіти -> формат (Excel/PDF), кожен звіт —
 *    це виклик уже наявної list-/get-функції з фільтром прав по ролі.
 */

// ==================== НАЛАШТУВАННЯ БОТА ====================

function getTelegramBotToken_() {
  return PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '';
}

function saveTelegramBotToken(token, botToken) {
  try {
    requireRole_(token, ['admin']);
    PropertiesService.getScriptProperties().setProperty('TELEGRAM_BOT_TOKEN', String(botToken || '').trim());
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

function tgPollingTriggerExists_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'pollTelegramUpdates_'; });
}

function getTelegramStatus(token) {
  try {
    requireRole_(token, ['admin']);
    var configured = !!getTelegramBotToken_();
    var botUsername = '', lastError = '';
    if (configured) {
      try {
        var me = tgCall_('getMe', {});
        if (me.ok) botUsername = '@' + me.result.username;
        else lastError = 'getMe: ' + (me.description || 'помилка токена — перевірте, чи правильно скопійовано токен');
      } catch (apiErr) {
        lastError = 'Не вдалося зв\'язатися з Telegram API: ' + apiErr.message;
      }
    }
    var props = PropertiesService.getScriptProperties();
    return ok_({
      configured: configured, botUsername: botUsername, lastError: lastError,
      pollingActive: tgPollingTriggerExists_(),
      lastPollAt: props.getProperty('TELEGRAM_LAST_POLL_AT') || '',
      linkedUsers: listTelegramLinkedUsers_internal_()
    });
  } catch (e) {
    return fail_(e.message);
  }
}

function installTelegramPollingTrigger(token) {
  try {
    requireRole_(token, ['admin']);
    if (!getTelegramBotToken_()) return fail_('Спочатку збережіть токен бота.');

    // Вебхук і опитування (getUpdates) не можуть бути активні одночасно —
    // поки вебхук зареєстрований, getUpdates повертає помилку. Прибираємо
    // вебхук (якщо колись реєструвався) і скидаємо чергу застарілих
    // апдейтів на боці Telegram, щоб вони не прилетіли всі разом.
    tgCall_('deleteWebhook', { drop_pending_updates: true });

    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'pollTelegramUpdates_') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('pollTelegramUpdates_').timeBased().everyMinutes(1).create();

    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

function removeTelegramPollingTrigger(token) {
  try {
    requireRole_(token, ['admin']);
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'pollTelegramUpdates_') ScriptApp.deleteTrigger(t);
    });
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * ЕКСТРЕНА ЗУПИНКА — якщо бот "звар'ював" і шле забагато повідомлень, а
 * заходити через веб-інтерфейс (Налаштування) незручно чи довго: відкрийте
 * цей файл у редакторі Apps Script, у випадаючому списку функцій зверху
 * оберіть "emergencyStopTelegramBot" і натисніть Run. НЕ потребує токена
 * сесії — прибирає тригер опитування І вебхук (про всяк випадок) та
 * скидає чергу недоставлених апдейтів у Telegram.
 */
function emergencyStopTelegramBot() {
  var json = tgCall_('deleteWebhook', { drop_pending_updates: true });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollTelegramUpdates_') ScriptApp.deleteTrigger(t);
  });
  Logger.log('emergencyStopTelegramBot: тригер опитування прибрано, вебхук видалено. ' + JSON.stringify(json));
  return json;
}

/**
 * Викликається щохвилини time-driven тригером (не через API_WHITELIST_,
 * запускається самим Apps Script — той самий підхід, що dailyLowStockDigest_
 * в Automation.gs). Забирає нові апдейти від Telegram і скидає позначку
 * "останній оброблений", щоб не забирати ті самі повідомлення повторно.
 */
function pollTelegramUpdates_() {
  if (!getTelegramBotToken_()) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // попередній прогін ще виконується — пропускаємо, наступний тригер (за хвилину) підхопить
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('TELEGRAM_LAST_POLL_AT', nowStr_());

    var lastId = Number(props.getProperty('TELEGRAM_LAST_UPDATE_ID') || 0);
    var json = tgCall_('getUpdates', { offset: lastId + 1, timeout: 0, limit: 50 });
    if (!json.ok || !json.result || !json.result.length) return;

    json.result.forEach(function (update) {
      try {
        handleTelegramUpdate_(update);
      } catch (procErr) {
        // Одне "отруєне" повідомлення не повинно блокувати всю чергу —
        // логуємо й ідемо далі, зсуваючи offset повз нього.
        Logger.log('pollTelegramUpdates_ processing error (update ' + update.update_id + '): ' + procErr.message);
      }
      if (update.update_id >= lastId) lastId = update.update_id;
    });
    props.setProperty('TELEGRAM_LAST_UPDATE_ID', String(lastId));
  } finally {
    lock.releaseLock();
  }
}

function listTelegramLinkedUsers_internal_() {
  var sheet = getDb_().getSheetByName(SHEET_TELEGRAM_USERS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  var list = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][idx.ChatID]) continue;
    list.push({
      chatId: String(data[i][idx.ChatID]), login: data[i][idx.Login],
      role: data[i][idx.Role], fullName: data[i][idx.FullName], linkedAt: data[i][idx.LinkedAt]
    });
  }
  return list;
}

function listTelegramLinkedUsers(token) {
  try {
    requireRole_(token, ['admin']);
    return ok_(listTelegramLinkedUsers_internal_());
  } catch (e) {
    return fail_(e.message);
  }
}

function unlinkTelegramUser(token, chatId) {
  try {
    requireRole_(token, ['admin']);
    return tgUnlinkChat_(chatId) ? ok_(true) : fail_('Не знайдено такого зв\'язаного чату.');
  } catch (e) {
    return fail_(e.message);
  }
}

// ==================== НИЗЬКОРІВНЕВІ ВИКЛИКИ TELEGRAM API ====================

function tgApiUrl_(method) {
  var botToken = getTelegramBotToken_();
  if (!botToken) throw new Error('Telegram бот не налаштовано.');
  return 'https://api.telegram.org/bot' + botToken + '/' + method;
}

function tgCall_(method, payload) {
  var options = {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload || {}), muteHttpExceptions: true
  };
  var resp = UrlFetchApp.fetch(tgApiUrl_(method), options);
  var json = JSON.parse(resp.getContentText());
  if (!json.ok) Logger.log('Telegram API "' + method + '" error: ' + resp.getContentText());
  return json;
}

/**
 * Запобіжник від "заспамлення" одного чату: якщо з будь-якої причини
 * (повторні доставки від Telegram, помилка логіки, що постійно тригериться)
 * бот намагається надіслати забагато повідомлень в один чат за короткий
 * час — зупиняємось, а не шлемо їх усі підряд. Це діє НЕЗАЛЕЖНО від причини,
 * навіть якщо десь-інде в коді лишився недогляд.
 */
function tgRateLimitOk_(chatId) {
  var cache = CacheService.getScriptCache();
  var key = 'tg_rate_' + chatId;
  var count = Number(cache.get(key) || 0);
  if (count >= 12) return false; // забагато за останню хвилину — щось не так, зупиняємось
  cache.put(key, String(count + 1), 60);
  return true;
}

function tgSendMessage_(chatId, text, replyMarkup) {
  if (!tgRateLimitOk_(chatId)) { Logger.log('Telegram rate limit hit for chat ' + chatId + ', skipping send.'); return { ok: false, description: 'rate-limited' }; }
  var payload = { chat_id: String(chatId), text: String(text).slice(0, 4090), parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return tgCall_('sendMessage', payload);
}

function tgAnswerCallbackQuery_(callbackQueryId, text) {
  return tgCall_('answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || '' });
}

/**
 * Надсилання файлу (Blob) — окремо від tgCall_, бо потребує multipart/form-data,
 * а не JSON. UrlFetchApp сам формує multipart, коли значення в payload — Blob.
 */
function tgSendDocument_(chatId, blob, caption) {
  if (!tgRateLimitOk_(chatId)) { Logger.log('Telegram rate limit hit for chat ' + chatId + ', skipping document send.'); return { ok: false, description: 'rate-limited' }; }
  var url = 'https://api.telegram.org/bot' + getTelegramBotToken_() + '/sendDocument';
  var payload = { chat_id: String(chatId), document: blob };
  if (caption) payload.caption = String(caption).slice(0, 1024);
  var resp = UrlFetchApp.fetch(url, { method: 'post', payload: payload, muteHttpExceptions: true });
  var json = JSON.parse(resp.getContentText());
  if (!json.ok) Logger.log('Telegram sendDocument error: ' + resp.getContentText());
  return json;
}

/**
 * Надсилає повідомлення всім прив'язаним адміністраторам. Тихо виходить,
 * якщо бот не налаштований або нікого не прив'язано — виклики цієї функції
 * ніколи не повинні ламати ту дію, з якої вони викликані (нове замовлення,
 * щоденний дайджест тощо).
 */
function tgNotifyAdmins_(text) {
  if (!getTelegramBotToken_()) return;
  try {
    listTelegramLinkedUsers_internal_().filter(function (u) { return u.role === 'admin'; }).forEach(function (u) {
      try { tgSendMessage_(u.chatId, text); } catch (sendErr) { Logger.log('tgNotifyAdmins_ send error: ' + sendErr.message); }
    });
  } catch (e) {
    Logger.log('tgNotifyAdmins_ error: ' + e.message);
  }
}

// ==================== ПРИВ'ЯЗКА КОРИСТУВАЧА ДО ЧАТУ ====================

/**
 * Повертає {id, login, role, fullName} для прив'язаного chatId, або null,
 * якщо не прив'язано ЧИ обліковий запис деактивовано/видалено (в обох
 * випадках доступ через Telegram теж має закритись). Заодно синхронізує
 * кешовані Role/FullName у TelegramUsers, якщо їх змінили в Users.
 */
function tgFindUser_(chatId) {
  var ss = getDb_();
  var tgSheet = ss.getSheetByName(SHEET_TELEGRAM_USERS);
  var tgData = tgSheet.getDataRange().getValues();
  var tgIdx = indexMap_(tgData[0]);
  var rowNum = null, userId = null;
  for (var i = 1; i < tgData.length; i++) {
    if (String(tgData[i][tgIdx.ChatID]) === String(chatId)) { rowNum = i + 1; userId = tgData[i][tgIdx.UserID]; break; }
  }
  if (!rowNum) return null;

  var usersSheet = ss.getSheetByName(SHEET_USERS);
  var usersData = usersSheet.getDataRange().getValues();
  var usersIdx = indexMap_(usersData[0]);
  for (var j = 1; j < usersData.length; j++) {
    if (usersData[j][usersIdx.ID] === userId) {
      if (!usersData[j][usersIdx.Active]) return null;
      var user = {
        id: userId, login: usersData[j][usersIdx.Login],
        role: usersData[j][usersIdx.Role], fullName: usersData[j][usersIdx.FullName]
      };
      if (tgData[rowNum - 1][tgIdx.Role] !== user.role || tgData[rowNum - 1][tgIdx.FullName] !== user.fullName) {
        tgSheet.getRange(rowNum, tgIdx.Role + 1).setValue(user.role);
        tgSheet.getRange(rowNum, tgIdx.FullName + 1).setValue(user.fullName);
      }
      return user;
    }
  }
  return null;
}

/**
 * Логін через ТОЙ САМИЙ Auth.gs::login(), що й веб-версія — паролі ніде
 * не дублюються й не зберігаються окремо для Telegram.
 */
function tgLinkUser_(chatId, loginName, password) {
  try {
    var res = login(loginName, password);
    if (!res.success) return res; // невірний логін/пароль чи деактивований — login() вже дає зрозумілий текст
    var user = res.data.user;

    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_TELEGRAM_USERS);
    if (!sheet) {
      // Аркуш TelegramUsers мав з'явитись через ensureDatabase_() при першому
      // ж вебхук-запиті, але якщо з якоїсь причини цього не сталось —
      // намагаємось самовідновитись тут, а не просто впасти з незрозумілою
      // помилкою на рівному місці.
      ensureDatabase_();
      sheet = ss.getSheetByName(SHEET_TELEGRAM_USERS);
    }
    if (!sheet) return fail_('Аркуш TelegramUsers відсутній у базі. Відкрийте веб-версію застосунку хоч раз (щоб оновилась схема) і спробуйте ще раз.');

    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idx.ChatID]) === String(chatId)) {
        sheet.getRange(i + 1, idx.UserID + 1).setValue(user.id);
        sheet.getRange(i + 1, idx.Login + 1).setValue(user.login);
        sheet.getRange(i + 1, idx.Role + 1).setValue(user.role);
        sheet.getRange(i + 1, idx.FullName + 1).setValue(user.fullName);
        sheet.getRange(i + 1, idx.LinkedAt + 1).setValue(nowStr_());
        return ok_(user);
      }
    }
    sheet.appendRow([String(chatId), user.id, user.login, user.role, user.fullName, nowStr_()]);
    return ok_(user);
  } catch (e) {
    return fail_('Помилка прив\'язки: ' + e.message);
  }
}

function tgUnlinkChat_(chatId) {
  var sheet = getDb_().getSheetByName(SHEET_TELEGRAM_USERS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.ChatID]) === String(chatId)) { sheet.deleteRow(i + 1); return true; }
  }
  return false;
}

function tgRoleLabel_(role) {
  return role === 'admin' ? 'адміністратор' : (role === 'storekeeper' ? 'комірник' : 'перегляд');
}

/**
 * Робить короткочасну (8 год.) сесію для вже верифікованого через
 * Telegram-прив'язку користувача, щоб викликати наявні server-функції,
 * які всі вимагають token — без повторного вводу пароля щоразу.
 */
function tgSessionToken_(user) {
  return createSession_(user);
}

// ==================== КОМАНДИ / МЕНЮ ====================

function handleTelegramUpdate_(update) {
  // Захист від дублів: якщо Apps Script (холодний старт, читання аркушів,
  // звернення до Telegram API за sendMessage) не встигає відповісти Telegram
  // досить швидко, він вважає доставку невдалою й повторно шле ТОЙ САМИЙ
  // апдейт (той самий update_id) — інколи по кілька разів поспіль. Без цієї
  // перевірки один /login чи натиск кнопки обробляється і надсилає
  // відповідь щоразу заново. tgClaimUpdate_ дозволяє обробити кожен
  // update_id рівно один раз.
  if (!tgClaimUpdate_(update.update_id)) return;
  if (update.callback_query) { tgHandleCallback_(update.callback_query); return; }
  if (update.message) { tgHandleMessage_(update.message); return; }
}

function tgClaimUpdate_(updateId) {
  if (!updateId) return true; // немає update_id (нетиповий апдейт) — не блокуємо обробку
  var cache = CacheService.getScriptCache();
  var key = 'tg_upd_' + updateId;
  if (cache.get(key)) return false; // цей update_id вже оброблено — це повторна доставка
  cache.put(key, '1', 21600); // 6 год — з великим запасом понад реальний період повторів Telegram
  return true;
}

function tgHelpText_() {
  return 'Команди:\n' +
    '/login логін пароль — увійти (той самий логін/пароль, що й у веб-версії)\n' +
    '/logout — вийти\n' +
    '/menu — розділи звітів і документів (Excel/PDF)\n' +
    '/help — ця підказка';
}

function tgHandleMessage_(message) {
  var chatId = message.chat && message.chat.id;
  if (!chatId) return;
  var text = String(message.text || '').trim();

  if (text.indexOf('/login') === 0) {
    var parts = text.split(/\s+/);
    if (parts.length < 3) { tgSendMessage_(chatId, 'Формат: <code>/login логін пароль</code>'); return; }
    var res = tgLinkUser_(chatId, parts[1], parts.slice(2).join(' '));
    if (!res.success) { tgSendMessage_(chatId, '❌ ' + res.error); return; }
    tgSendMessage_(chatId, '✅ Увійшли як ' + (res.data.fullName || res.data.login) + ' (' + tgRoleLabel_(res.data.role) + ').\nНадішліть /menu, щоб побачити звіти й документи.');
    return;
  }

  if (text.indexOf('/logout') === 0) {
    tgUnlinkChat_(chatId);
    tgSendMessage_(chatId, 'Вихід виконано. Щоб знову користуватись ботом — <code>/login логін пароль</code>');
    return;
  }

  if (text.indexOf('/start') === 0) {
    tgSendMessage_(chatId,
      '👋 Це бот SH ERP.\n\nУвійдіть тим самим логіном/паролем, що й у веб-версії:\n<code>/login логін пароль</code>\n\nПотім /menu покаже звіти й документи (Excel/PDF).');
    return;
  }

  var user = tgFindUser_(chatId);
  if (!user) { tgSendMessage_(chatId, 'Спершу увійдіть: <code>/login логін пароль</code>'); return; }

  if (text.indexOf('/help') === 0) { tgSendMessage_(chatId, tgHelpText_()); return; }

  // /menu, /reports або будь-який інший текст — показуємо меню розділів
  tgSendMessage_(chatId, 'Оберіть розділ:', tgCategoriesKeyboard_(user));
}

function tgHandleCallback_(cq) {
  var chatId = cq.message && cq.message.chat && cq.message.chat.id;
  var data = String(cq.data || '');
  try { tgAnswerCallbackQuery_(cq.id, ''); } catch (ackErr) {}
  if (!chatId) return;

  var user = tgFindUser_(chatId);
  if (!user) { tgSendMessage_(chatId, 'Сесію завершено, увійдіть знову: <code>/login логін пароль</code>'); return; }

  if (data === 'cats') { tgSendMessage_(chatId, 'Оберіть розділ:', tgCategoriesKeyboard_(user)); return; }

  if (data.indexOf('cat:') === 0) {
    tgSendMessage_(chatId, 'Оберіть документ:', tgReportsKeyboard_(data.slice(4), user));
    return;
  }

  if (data.indexOf('rep:') === 0) {
    tgSendMessage_(chatId, 'У якому форматі?', tgFormatKeyboard_(data.slice(4)));
    return;
  }

  if (data.indexOf('fmt:') === 0) {
    var parts = data.split(':'); // fmt:reportKey:xlsx|pdf
    tgSendMessage_(chatId, '⏳ Готую файл...');
    tgSendReport_(chatId, user, parts[1], parts[2]);
    return;
  }
}

// ==================== КАТАЛОГ ЗВІТІВ/ДОКУМЕНТІВ ====================

var TG_CATEGORIES_ = [
  { key: 'stock', label: '📦 Склад' },
  { key: 'prod', label: '🏭 Виробництво' },
  { key: 'sales', label: '🧾 Продажі' },
  { key: 'supply', label: '🚚 Постачання' },
  { key: 'hr', label: '👥 Персонал' }
];

/**
 * Перетворює {success, data: [...]} у {success, data: {headers, rows}}
 * для однакової подальшої генерації Excel/PDF.
 */
function tgListToTable_(listResult, columns) {
  if (!listResult.success) return fail_(listResult.error);
  var headers = columns.map(function (c) { return c[1]; });
  var rows = listResult.data.map(function (item) {
    return columns.map(function (c) {
      var v = item[c[0]];
      if (v === true) return 'так';
      if (v === false) return 'ні';
      if (v === null || v === undefined) return '';
      return v;
    });
  });
  return ok_({ headers: headers, rows: rows });
}

function tgWarehouseValueTable_(token) {
  var res = getWarehouseValueReport(token);
  if (!res.success) return fail_(res.error);
  var headers = ['Категорія', 'Наша без ПДВ', 'Наша з ПДВ', 'Німецька без ПДВ', 'Німецька з ПДВ', 'За ціною продажу'];
  var rows = res.data.categoryBreakdown.map(function (c) {
    return [c.category, c.localExclVat, c.localInclVat, c.germanExclVat, c.germanInclVat, c.sellPrice];
  });
  var t = res.data.totals;
  rows.push(['РАЗОМ', t.localExclVat, t.localInclVat, t.germanExclVat, t.germanInclVat, t.sellPrice]);
  return ok_({ headers: headers, rows: rows });
}

function tgPayrollTable_(token) {
  var toDate = new Date();
  var fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  var from = Utilities.formatDate(fromDate, 'Europe/Kyiv', 'yyyy-MM-dd');
  var to = Utilities.formatDate(toDate, 'Europe/Kyiv', 'yyyy-MM-dd');
  var res = getPayrollSummaryReport(token, from, to);
  return tgListToTable_(res, [
    ['fullName', 'ПІБ'], ['earned', 'Відрядна'], ['bonuses', 'Премії'], ['penalties', 'Штрафи'],
    ['advances', 'Аванси'], ['total', 'Разом'], ['units', 'Одиниць'], ['defects', 'Брак']
  ]);
}

var TG_REPORTS_ = [
  { key: 'products', category: 'stock', label: 'Усі товари', roles: null,
    fetch: function (user, token) { return tgListToTable_(listProducts(token),
      [['article', 'Артикул'], ['name', 'Назва'], ['category', 'Категорія'], ['unit', 'Од.'], ['qty', 'Залишок'], ['minQty', 'Мін.залишок'], ['cell', 'Комірка']]); } },
  { key: 'lowstock', category: 'stock', label: 'Нижче мінімуму', roles: null,
    fetch: function (user, token) { return tgListToTable_(getLowStockProducts(token),
      [['article', 'Артикул'], ['name', 'Назва'], ['qty', 'Залишок'], ['reservedQty', 'Резерв'], ['availableQty', 'Доступно'], ['minQty', 'Мін.залишок']]); } },
  { key: 'reorder', category: 'stock', label: 'Пропозиції закупівлі', roles: null,
    fetch: function (user, token) { return tgListToTable_(getReorderSuggestions(token),
      [['article', 'Артикул'], ['name', 'Назва'], ['availableQty', 'Доступно'], ['minQty', 'Мін.залишок'], ['suggestedQty', 'Замовити']]); } },
  { key: 'warehouses', category: 'stock', label: 'Віртуальні склади', roles: null,
    fetch: function (user, token) { return tgListToTable_(listWarehouses(token),
      [['name', 'Назва'], ['isDefault', 'За замовч.']]); } },
  { key: 'history', category: 'stock', label: 'Історія (200 останніх)', roles: null,
    fetch: function (user, token) { return tgListToTable_(getHistory(token, 200),
      [['timestamp', 'Дата/час'], ['user', 'Хто'], ['action', 'Дія'], ['article', 'Артикул'], ['name', 'Назва'], ['qty', 'К-сть'], ['comment', 'Коментар']]); } },

  { key: 'assemblies', category: 'prod', label: 'Вироби (BOM)', roles: null,
    fetch: function (user, token) { return tgListToTable_(listAssemblies(token),
      [['article', 'Артикул'], ['name', 'Назва'], ['componentCount', 'Компонентів'], ['availableInStock', 'На складі']]); } },
  { key: 'prodorders', category: 'prod', label: 'Виробничі замовлення', roles: null,
    fetch: function (user, token) { return tgListToTable_(listProductionOrders(token, null),
      [['assemblyName', 'Виріб'], ['unitsPlanned', 'К-сть'], ['status', 'Статус'], ['user', 'Хто'], ['createdAt', 'Створено'], ['completedAt', 'Завершено']]); } },
  { key: 'prodreport', category: 'prod', label: 'Звіт виробництва по місяцях', roles: null,
    fetch: function (user, token) { return tgListToTable_(getProductionReport(token),
      [['month', 'Місяць'], ['orders', 'Замовлень'], ['units', 'Одиниць'], ['costEur', 'Собівартість (EUR)']]); } },
  { key: 'finishedgoods', category: 'prod', label: 'Готова продукція', roles: null,
    fetch: function (user, token) { return tgListToTable_(listFinishedGoods(token, {}),
      [['serialNumber', 'Серійний №'], ['assemblyName', 'Виріб'], ['manufactureDate', 'Дата виготовл.'], ['status', 'Статус']]); } },
  { key: 'qc', category: 'prod', label: 'Контроль якості', roles: null,
    fetch: function (user, token) { return tgListToTable_(listQualityChecks(token, {}),
      [['serialNumber', 'Серійний №'], ['result', 'Результат'], ['inspector', 'Перевірив'], ['checkedAt', 'Дата'], ['comment', 'Коментар']]); } },
  { key: 'inventory', category: 'prod', label: 'Інвентаризації', roles: null,
    fetch: function (user, token) { return tgListToTable_(listInventorySessions(token),
      [['name', 'Назва'], ['status', 'Статус'], ['startedBy', 'Хто почав'], ['startedAt', 'Початок'], ['completedAt', 'Завершено']]); } },

  { key: 'customerorders', category: 'sales', label: 'Замовлення клієнтів', roles: null,
    fetch: function (user, token) { return tgListToTable_(listCustomerOrders(token, null),
      [['orderNumber', '№'], ['clientName', 'Клієнт'], ['deadline', 'Дедлайн'], ['priority', 'Пріоритет'], ['status', 'Статус'], ['itemCount', 'Позицій']]); } },
  { key: 'shipments', category: 'sales', label: 'Відвантаження', roles: null,
    fetch: function (user, token) { return tgListToTable_(listShipments(token, null),
      [['carrier', 'Перевізник'], ['waybillNumber', 'Накладна'], ['shipDate', 'Дата відправки'], ['status', 'Статус'], ['itemCount', 'Одиниць']]); } },

  { key: 'purchaseorders', category: 'supply', label: 'Замовлення постачальникам', roles: null,
    fetch: function (user, token) { return tgListToTable_(listPurchaseOrders(token, null),
      [['supplier', 'Постачальник'], ['status', 'Статус'], ['orderDate', 'Дата замовл.'], ['expectedDeliveryDate', 'Очік. доставка'], ['itemCount', 'Позицій']]); } },
  { key: 'suppliers', category: 'supply', label: 'Постачальники', roles: null,
    fetch: function (user, token) { return tgListToTable_(listSuppliers(token),
      [['name', 'Назва'], ['contactPerson', 'Контакт'], ['phone', 'Телефон'], ['email', 'Email']]); } },
  { key: 'warehousevalue', category: 'supply', label: 'Вартість складу (admin)', roles: ['admin'],
    fetch: function (user, token) { return tgWarehouseValueTable_(token); } },

  { key: 'employees', category: 'hr', label: 'Працівники', roles: ['admin'],
    fetch: function (user, token) { return tgListToTable_(listEmployees(token, false),
      [['fullName', 'ПІБ'], ['position', 'Посада'], ['phone', 'Телефон'], ['status', 'Статус'], ['hireDate', 'Прийнято']]); } },
  { key: 'payroll', category: 'hr', label: 'Зарплата (90 днів)', roles: ['admin'],
    fetch: function (user, token) { return tgPayrollTable_(token); } }
];

function tgReportAllowed_(report, user) {
  return !report.roles || report.roles.indexOf(user.role) !== -1;
}

function tgCategoriesKeyboard_(user) {
  var rows = TG_CATEGORIES_.map(function (c) {
    var hasAny = TG_REPORTS_.some(function (r) { return r.category === c.key && tgReportAllowed_(r, user); });
    return hasAny ? [{ text: c.label, callback_data: 'cat:' + c.key }] : null;
  }).filter(function (r) { return r; });
  return { inline_keyboard: rows };
}

function tgReportsKeyboard_(categoryKey, user) {
  var rows = TG_REPORTS_.filter(function (r) { return r.category === categoryKey && tgReportAllowed_(r, user); })
    .map(function (r) { return [{ text: r.label, callback_data: 'rep:' + r.key }]; });
  rows.push([{ text: '⬅️ Назад до розділів', callback_data: 'cats' }]);
  return { inline_keyboard: rows };
}

function tgFormatKeyboard_(reportKey) {
  return {
    inline_keyboard: [
      [{ text: '📊 Excel', callback_data: 'fmt:' + reportKey + ':xlsx' }, { text: '📄 PDF', callback_data: 'fmt:' + reportKey + ':pdf' }],
      [{ text: '⬅️ Назад', callback_data: 'cats' }]
    ]
  };
}

function tgSendReport_(chatId, user, reportKey, format) {
  var report = TG_REPORTS_.filter(function (r) { return r.key === reportKey; })[0];
  if (!report) { tgSendMessage_(chatId, 'Невідомий документ.'); return; }
  if (!tgReportAllowed_(report, user)) { tgSendMessage_(chatId, 'Немає доступу до цього документа.'); return; }

  try {
    var token = tgSessionToken_(user);
    var table = report.fetch(user, token);
    if (!table.success) { tgSendMessage_(chatId, '❌ ' + table.error); return; }
    if (!table.data.rows.length) { tgSendMessage_(chatId, 'Даних немає — файл не створено.'); return; }

    var blob = format === 'pdf'
      ? tgCreatePdfBlob_(report.label, table.data.headers, table.data.rows)
      : tgCreateExcelBlob_(report.label, table.data.headers, table.data.rows);

    var sendResult = tgSendDocument_(chatId, blob, report.label + ' — ' + nowStr_());
    if (!sendResult.ok) {
      // РАНІШЕ помилку від sendDocument ніхто не перевіряв — файл міг
      // "успішно" піти биткою, і користувач бачив незрозумілий результат
      // без жодного пояснення. Тепер показуємо, що саме сказав Telegram.
      tgSendMessage_(chatId, '❌ Telegram відхилив файл: ' + (sendResult.description || 'невідома причина'));
    }
  } catch (e) {
    Logger.log('tgSendReport_ error: ' + e.message);
    tgSendMessage_(chatId, '❌ Не вдалося сформувати файл: ' + e.message);
  }
}

// ==================== ГЕНЕРАЦІЯ ФАЙЛІВ ====================

function tgCreateExcelBlob_(title, headers, rows) {
  var safeTitle = String(title).slice(0, 90);
  var file = SpreadsheetApp.create('tg_' + safeTitle);
  var fileId = file.getId();
  try {
    var sh = file.getActiveSheet();
    var allRows = [headers].concat(rows);
    sh.getRange(1, 1, allRows.length, headers.length).setValues(allRows);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    SpreadsheetApp.flush();

    // РАНІШЕ тут був ручний fetch на docs.google.com/.../export з OAuth-
    // токеном — саме ЦЕ регулярно поверталось биткою/незрозумілою
    // відповіддю (щойно створений файл ще не встигає реплікуватись на
    // боці Google до того шляху, яким іде export-посилання, або токену
    // не вистачає неявної сфери дій саме для цього маршруту). Замінено на
    // офіційну конвертацію через сам Drive-сервіс (getAs) — той самий
    // надійний механізм, яким нижче вже стабільно генерується PDF.
    var blob = DriveApp.getFileById(fileId).getAs(MimeType.MICROSOFT_EXCEL).setName(safeTitle + '.xlsx');
    if (!blob || blob.getBytes().length < 100) {
      throw new Error('Google Drive повернув порожній файл Excel.');
    }
    return blob;
  } finally {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (cleanupErr) {}
  }
}

function tgCreatePdfBlob_(title, headers, rows) {
  var safeTitle = String(title).slice(0, 90);
  var doc = DocumentApp.create('tg_' + safeTitle);
  var docId = doc.getId();
  try {
    var body = doc.getBody();
    try { body.setPageWidth(841.89).setPageHeight(595.28); } catch (pageErr) {} // A4 альбомна — для таблиць з багатьма колонками
    body.appendParagraph(safeTitle).setHeading(DocumentApp.ParagraphHeading.HEADING2);

    var tableData = [headers].concat(rows).map(function (r) {
      return r.map(function (v) { return v === null || v === undefined ? '' : String(v); });
    });
    var table = body.appendTable(tableData);
    var headerRow = table.getRow(0);
    for (var c = 0; c < headerRow.getNumCells(); c++) {
      headerRow.getCell(c).setBackgroundColor('#eeeeee');
      headerRow.getCell(c).editAsText().setBold(true);
    }

    doc.saveAndClose();
    var blob = DriveApp.getFileById(docId).getAs('application/pdf').setName(safeTitle + '.pdf');
    if (!blob || blob.getBytes().length < 100) {
      throw new Error('Google Drive повернув порожній файл PDF.');
    }
    return blob;
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (cleanupErr) {}
  }
}
