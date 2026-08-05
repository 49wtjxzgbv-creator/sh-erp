/**
 * Auth.gs — вхід, сесії, перевірка ролей.
 * Токен сесії передається клієнтом у кожному виклику google.script.run
 * (зберігається в sessionStorage браузера).
 */

function hashPassword_(plain) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, plain, Utilities.Charset.UTF_8);
  return digest.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/**
 * Вхід у систему. Повертає токен сесії та дані користувача.
 */
function login(loginName, password) {
  try {
    loginName = String(loginName || '').trim();
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_USERS);
    if (!sheet) return fail_('Базу даних ще не ініціалізовано. У редакторі Apps Script запустіть функцію "setupDatabase" (файл Setup.gs), потім спробуйте увійти знову.');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idx = indexMap_(headers);

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[idx.Login]).toLowerCase() === loginName.toLowerCase()) {
        if (!row[idx.Active]) return fail_('Обліковий запис деактивовано.');
        if (row[idx.PasswordHash] !== hashPassword_(password)) return fail_('Невірний логін або пароль.');

        var user = {
          id: row[idx.ID],
          login: row[idx.Login],
          role: row[idx.Role],
          fullName: row[idx.FullName]
        };
        var token = createSession_(user);
        return ok_({ token: token, user: user });
      }
    }
    return fail_('Невірний логін або пароль.');
  } catch (e) {
    return fail_(e.message);
  }
}

function createSession_(user) {
  var token = Utilities.getUuid();
  var cache = CacheService.getScriptCache();
  cache.put('session_' + token, JSON.stringify(user), SESSION_TTL_SEC);
  return token;
}

/**
 * Повертає дані користувача за токеном, або null якщо сесія недійсна.
 */
function getSessionUser_(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var raw = cache.get('session_' + token);
  if (!raw) return null;
  return JSON.parse(raw);
}

/**
 * Перевірка сесії, викликається клієнтом для відновлення стану після перезавантаження.
 */
function checkSession(token) {
  var user = getSessionUser_(token);
  if (!user) return fail_('Сесія недійсна або застаріла.');
  return ok_({ user: user });
}

function logout(token) {
  var cache = CacheService.getScriptCache();
  cache.remove('session_' + token);
  return ok_(true);
}

/**
 * Кидає помилку, якщо користувач не автентифікований.
 * Повертає об'єкт користувача.
 */
function requireAuth_(token) {
  var user = getSessionUser_(token);
  if (!user) throw new Error('AUTH_REQUIRED');
  return user;
}

/**
 * Кидає помилку, якщо роль користувача не входить у дозволений список.
 */
function requireRole_(token, allowedRoles) {
  var user = requireAuth_(token);
  if (allowedRoles.indexOf(user.role) === -1) {
    throw new Error('Недостатньо прав для цієї дії.');
  }
  return user;
}

function indexMap_(headers) {
  var map = {};
  headers.forEach(function (h, i) { map[h] = i; });
  return map;
}

/**
 * Дозволяє будь-якому автентифікованому користувачу самостійно змінити
 * власний пароль (на відміну від Users.gs, де адмін змінює паролі інших).
 */
function changeOwnPassword(token, oldPassword, newPassword) {
  try {
    var user = requireAuth_(token);
    if (!newPassword || String(newPassword).length < 4) {
      return fail_('Новий пароль має містити щонайменше 4 символи.');
    }

    var sheet = getDb_().getSheetByName(SHEET_USERS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === user.id) {
        if (data[i][idx.PasswordHash] !== hashPassword_(oldPassword)) {
          return fail_('Поточний пароль невірний.');
        }
        sheet.getRange(i + 1, idx.PasswordHash + 1).setValue(hashPassword_(newPassword));
        return ok_(true);
      }
    }
    return fail_('Користувача не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}
