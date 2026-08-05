/**
 * History.gs — незмінний журнал усіх операцій.
 * Немає жодної функції видалення записів — це навмисно
 * (вимога ТЗ: "Історія не повинна видалятися").
 */

function logHistory_(user, action, article, name, qty, comment) {
  var sheet = getDb_().getSheetByName(SHEET_HISTORY);
  sheet.appendRow([
    nowStr_(),
    user.fullName || user.login,
    action,
    article || '',
    name || '',
    qty || 0,
    comment || ''
  ]);
}

/**
 * Повертає історію, найновіші записи першими.
 * Доступно всім автентифікованим користувачам (перегляд, не редагування).
 */
function getHistory(token, limit) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_HISTORY);
    var data = sheet.getDataRange().getValues();
    var headers = data.shift();
    var idx = indexMap_(headers);

    var rows = data.map(function (row) {
      return {
        timestamp: row[idx.Timestamp],
        user: row[idx.User],
        action: row[idx.Action],
        article: row[idx.Article],
        name: row[idx.Name],
        qty: row[idx.Qty],
        comment: row[idx.Comment]
      };
    }).reverse();

    if (limit) rows = rows.slice(0, Number(limit));
    return ok_(rows);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Історія по конкретному товару (за артикулом).
 */
function getProductHistory(token, article) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_HISTORY);
    var data = sheet.getDataRange().getValues();
    var headers = data.shift();
    var idx = indexMap_(headers);

    var rows = data
      .filter(function (row) { return row[idx.Article] === article; })
      .map(function (row) {
        return {
          timestamp: row[idx.Timestamp],
          user: row[idx.User],
          action: row[idx.Action],
          article: row[idx.Article],
          name: row[idx.Name],
          qty: row[idx.Qty],
          comment: row[idx.Comment]
        };
      }).reverse();

    return ok_(rows);
  } catch (e) {
    return fail_(e.message);
  }
}
