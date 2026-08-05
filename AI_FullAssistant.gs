/**
 * AI_FullAssistant.gs — повноцінний AI-асистент через Gemini function calling.
 *
 * Принцип: замість того щоб напихати Gemini текстом усієї бази (неможливо —
 * забагато даних), ми даємо їй список "інструментів" (функцій), які вона сама
 * вирішує викликати залежно від запитання. Ми виконуємо запитаний виклик,
 * повертаємо результат назад у Gemini, і так по колу, доки вона не сформує
 * фінальну відповідь (або сама не запросить створити файл-звіт).
 */

var AI_TOOLS_ = [
  { name: 'searchProducts', description: 'Пошук товарів у базі складу за назвою чи артикулом. Повертає залишок, мінімальний залишок, ціни.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Пошуковий запит' } }, required: ['query'] } },
  { name: 'getLowStockProducts', description: 'Список товарів, залишок яких нижче мінімального — що варто замовити.',
    parameters: { type: 'object', properties: {} } },
  { name: 'searchAssemblies', description: 'Пошук виробів за назвою чи артикулом. Повертає собівартість, кількість компонентів, наявність на складі.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'getAssemblyDetail', description: 'Повна інформація про один виріб за назвою чи артикулом: з чого складається, собівартість, постачальник.',
    parameters: { type: 'object', properties: { nameOrArticle: { type: 'string' } }, required: ['nameOrArticle'] } },
  { name: 'listCustomerOrders', description: 'Список замовлень клієнтів, за бажанням відфільтрований за статусом (new, in_production, completed, cancelled).',
    parameters: { type: 'object', properties: { status: { type: 'string' } } } },
  { name: 'getCustomerOrderDetail', description: 'Повна інформація про замовлення клієнта за назвою клієнта чи номером замовлення: позиції, статуси виробництва, вартість, % виконання.',
    parameters: { type: 'object', properties: { clientNameOrNumber: { type: 'string' } }, required: ['clientNameOrNumber'] } },
  { name: 'listProductionOrders', description: 'Список виробничих замовлень, за бажанням відфільтрований за статусом (planned, in_progress, completed).',
    parameters: { type: 'object', properties: { status: { type: 'string' } } } },
  { name: 'listPurchaseOrders', description: 'Список замовлень постачальникам, за бажанням відфільтрований за статусом (ordered, delivered).',
    parameters: { type: 'object', properties: { status: { type: 'string' } } } },
  { name: 'listSuppliers', description: 'Список усіх постачальників.', parameters: { type: 'object', properties: {} } },
  { name: 'getWarehouseSummary', description: 'Загальна вартість складу за різними типами цін, кількість позицій.',
    parameters: { type: 'object', properties: {} } },
  { name: 'getPayrollSummary', description: 'Зведення по зарплаті працівників за період (тільки для адміністратора).',
    parameters: { type: 'object', properties: { dateFrom: { type: 'string' }, dateTo: { type: 'string' } } } },
  { name: 'exportToExcel', description: 'Створює новий файл Google Таблиці з переданими даними і повертає посилання на нього — використовуй, коли просять "зроби ексель", "вивантаж у таблицю" тощо.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Назва файлу' },
        headers: { type: 'array', items: { type: 'string' }, description: 'Назви колонок' },
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Рядки даних, кожен рядок — масив значень по колонках' }
      },
      required: ['title', 'headers', 'rows']
    } },
  { name: 'exportToPdf', description: 'Створює PDF-документ із заголовком і текстом та повертає посилання — використовуй для звітів, листів, підсумків.',
    parameters: { type: 'object', properties: { title: { type: 'string' }, bodyText: { type: 'string', description: 'Повний текст документа' } }, required: ['title', 'bodyText'] } },
  { name: 'forecastPurchaseNeeds', description: 'Аналізує темп витрати товарів за останні 30-90 днів (з історії складу) і прогнозує, коли товар закінчиться та скільки варто замовити. Якщо запит порожній — аналізує всі товари з помітним рухом.',
    parameters: { type: 'object', properties: { articleOrQuery: { type: 'string', description: 'Артикул чи назва товару, або порожньо для всіх' } } } },
  { name: 'findProductionDelays', description: 'Знаходить виробничі замовлення, які "застрягли" — довго заплановані, але не запущені, або давно не просувались по етапах. Допомагає знайти причини простоїв.',
    parameters: { type: 'object', properties: {} } },
  { name: 'adjustProductStock', description: 'КРИТИЧНА ДІЯ: змінює фактичний залишок товару на складі вручну. Вимагає підтвердження користувача перед виконанням — НЕ виконується одразу.',
    parameters: {
      type: 'object',
      properties: { article: { type: 'string' }, newQty: { type: 'number' }, reason: { type: 'string', description: 'Причина коригування' } },
      required: ['article', 'newQty', 'reason']
    } }
];

// Інструменти, що змінюють дані, — НІКОЛИ не виконуються одразу. Замість
// цього повертається запит на підтвердження користувачем.
var AI_CRITICAL_TOOLS_ = { adjustProductStock: true };

function callGeminiWithTools_(contents) {
  var apiKey = getGeminiApiKey_();
  if (!apiKey) throw new Error('Gemini API ключ не налаштовано. Додайте його в Налаштування → AI.');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;
  // fetchGeminiJson_ (Gemini.gs) сам обробляє 429 "quota exceeded" з
  // автоматичним одним повтором за підказаною Google затримкою.
  var json = fetchGeminiJson_(url, { contents: contents, tools: [{ functionDeclarations: AI_TOOLS_ }] });
  if (!json.candidates || !json.candidates[0]) throw new Error('Gemini не повернув відповідь (можливо, заблоковано фільтром безпеки).');
  return json.candidates[0].content;
}

/**
 * Виконує запитаний Gemini інструмент. Кожен інструмент — легка обгортка над
 * реальними даними системи, повертає СТИСЛИЙ об'єкт (не всю таблицю), щоб не
 * роздувати діалог зайвим.
 */
function executeAiTool_(name, args, user) {
  // Захист критичних дій: незалежно від того, що саме попросили, ми НІКОЛИ
  // не виконуємо їх тут одразу — повертаємо запит на підтвердження, і
  // клієнт сам покаже користувачу кнопку "Підтвердити", яка викличе
  // ОКРЕМИЙ, явний серверний виклик confirmAiAction.
  if (AI_CRITICAL_TOOLS_[name]) {
    return { status: 'needs_confirmation', action: name, args: args, description: describeAiAction_(name, args) };
  }

  var ss = getDb_();

  if (name === 'searchProducts') {
    var q = String(args.query || '').toLowerCase();
    var sheet = ss.getSheetByName(SHEET_PRODUCTS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var results = [];
    for (var i = 1; i < data.length && results.length < 20; i++) {
      var p = rowToProduct_(data[i], idx);
      if (!p.article) continue;
      if (String(p.article).toLowerCase().indexOf(q) !== -1 || String(p.name).toLowerCase().indexOf(q) !== -1) {
        results.push({ article: p.article, name: p.name, qty: p.qty, minQty: p.minQty, unit: p.unit, sellPriceEur: user.role === 'admin' ? p.sellPriceEur : undefined });
      }
    }
    return { results: results, count: results.length };
  }

  if (name === 'getLowStockProducts') {
    var res = getLowStockProducts_internal_();
    return { items: res.slice(0, 30) };
  }

  if (name === 'searchAssemblies') {
    var q2 = String(args.query || '').toLowerCase();
    var listRes = listAssemblies(user.token_);
    var all = (listRes.success ? listRes.data : []);
    var matches = all.filter(function (a) {
      return String(a.article || '').toLowerCase().indexOf(q2) !== -1 || String(a.name).toLowerCase().indexOf(q2) !== -1;
    }).slice(0, 20);
    return { results: matches.map(function (a) { return { article: a.article, name: a.name, availableInStock: a.availableInStock, componentCount: a.componentCount, costEur: a.costLocal }; }) };
  }

  if (name === 'getAssemblyDetail') {
    var q3 = String(args.nameOrArticle || '').toLowerCase();
    var asmSheet = ss.getSheetByName(SHEET_ASSEMBLIES);
    var asmData = asmSheet.getDataRange().getValues();
    var asmIdx = indexMap_(asmData[0]);
    var foundId = null;
    for (var a = 1; a < asmData.length; a++) {
      if (String(asmData[a][asmIdx.Article] || '').toLowerCase() === q3 || String(asmData[a][asmIdx.Name] || '').toLowerCase().indexOf(q3) !== -1) {
        foundId = asmData[a][asmIdx.ID]; break;
      }
    }
    if (!foundId) return { error: 'Виріб не знайдено за запитом: ' + args.nameOrArticle };
    var detail = getAssembly(user.token_, foundId);
    if (!detail.success) return { error: detail.message };
    var d = detail.data;
    return {
      name: d.name, article: d.article,
      components: d.components.map(function (c) { return c.componentType === 'assembly' ? { type: 'виріб', name: c.name, qty: c.qtyPerUnit } : { type: 'товар', article: c.article, name: c.name, qty: c.qtyPerUnit, unit: c.unit }; }),
      totalCostLocal: d.totalLocalCostEur, defaultSupplierId: d.defaultSupplierId || null
    };
  }

  if (name === 'listCustomerOrders') {
    var coRes = listCustomerOrders(user.token_, args.status || null);
    var list = coRes.success ? coRes.data : [];
    return { orders: list.slice(0, 30).map(function (o) { return { orderNumber: o.orderNumber, clientName: o.clientName, status: o.status, deadline: o.deadline, priority: o.priority }; }) };
  }

  if (name === 'getCustomerOrderDetail') {
    var q4 = String(args.clientNameOrNumber || '').toLowerCase();
    var coSheet = ss.getSheetByName(SHEET_CUSTOMER_ORDERS);
    var coData = coSheet.getDataRange().getValues();
    var coIdx = indexMap_(coData[0]);
    var foundOrderId = null;
    for (var c = 1; c < coData.length; c++) {
      if (String(coData[c][coIdx.OrderNumber] || '').toLowerCase() === q4 || String(coData[c][coIdx.ClientName] || '').toLowerCase().indexOf(q4) !== -1) {
        foundOrderId = coData[c][coIdx.ID]; break;
      }
    }
    if (!foundOrderId) return { error: 'Замовлення не знайдено за запитом: ' + args.clientNameOrNumber };
    var orderDetail = getCustomerOrder(user.token_, foundOrderId);
    return orderDetail.success ? orderDetail.data : { error: orderDetail.message };
  }

  if (name === 'listProductionOrders') {
    var poRes = listProductionOrders(user.token_, args.status || null);
    var poList = poRes.success ? poRes.data : [];
    return { orders: poList.slice(0, 30).map(function (o) { return { assemblyName: o.assemblyName, unitsPlanned: o.unitsPlanned, status: o.status, createdAt: o.createdAt }; }) };
  }

  if (name === 'listPurchaseOrders') {
    var puRes = listPurchaseOrders(user.token_, args.status || null);
    var puList = puRes.success ? puRes.data : [];
    return { orders: puList.slice(0, 30).map(function (o) { return { supplier: o.supplier, status: o.status, orderDate: o.orderDate }; }) };
  }

  if (name === 'listSuppliers') {
    var supRes = listSuppliers(user.token_);
    return { suppliers: supRes.success ? supRes.data : [] };
  }

  if (name === 'getWarehouseSummary') {
    var whRes = getWarehouseValueReport(user.token_);
    return whRes.success ? whRes.data : { error: whRes.message };
  }

  if (name === 'getPayrollSummary') {
    if (user.role !== 'admin') return { error: 'Ця інформація доступна лише адміністратору.' };
    var payRes = getPayrollSummaryReport(user.token_, args.dateFrom || '', args.dateTo || '');
    return payRes.success ? payRes.data : { error: payRes.message };
  }

  if (name === 'exportToExcel') {
    var newSheetFile = SpreadsheetApp.create(args.title || 'Звіт SH ERP');
    var sh = newSheetFile.getActiveSheet();
    var rows = [args.headers || []].concat(args.rows || []);
    if (rows.length && rows[0].length) sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sh.getRange(1, 1, 1, (args.headers || []).length).setFontWeight('bold');
    DriveApp.getFileById(newSheetFile.getId()).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { fileUrl: newSheetFile.getUrl(), message: 'Файл Excel створено' };
  }

  if (name === 'exportToPdf') {
    var doc = DocumentApp.create(args.title || 'Документ SH ERP');
    var body = doc.getBody();
    body.appendParagraph(args.title || 'Документ').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    String(args.bodyText || '').split('\n').forEach(function (line) { body.appendParagraph(line); });
    doc.saveAndClose();
    var pdfBlob = DriveApp.getFileById(doc.getId()).getAs('application/pdf');
    var pdfFile = getPhotosFolder_().createFile(pdfBlob).setName((args.title || 'Документ') + '.pdf');
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    DriveApp.getFileById(doc.getId()).setTrashed(true); // прибираємо проміжний Doc, лишаємо тільки PDF
    return { fileUrl: pdfFile.getUrl(), message: 'PDF створено' };
  }

  if (name === 'forecastPurchaseNeeds') {
    return { forecast: forecastPurchaseNeeds_(args.articleOrQuery || '') };
  }

  if (name === 'findProductionDelays') {
    return { delays: findProductionDelays_() };
  }

  return { error: 'Невідомий інструмент: ' + name };
}

/**
 * Людський опис критичної дії — показується користувачу перед підтвердженням.
 */
function describeAiAction_(name, args) {
  if (name === 'adjustProductStock') return 'Змінити залишок товару "' + args.article + '" на ' + args.newQty + ' (причина: ' + args.reason + ')';
  return 'Дія: ' + name;
}

/**
 * Реальне виконання критичної дії — викликається ТІЛЬКИ після явного
 * підтвердження користувачем (окремий виклик з клієнта, не через Gemini).
 */
function confirmAiAction(token, action, args) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    if (!AI_CRITICAL_TOOLS_[action]) return fail_('Невідома або непідтверджувана дія.');

    if (action === 'adjustProductStock') {
      var productsSheet = getDb_().getSheetByName(SHEET_PRODUCTS);
      var productsData = productsSheet.getDataRange().getValues();
      var productsIdx = indexMap_(productsData[0]);
      var productId = null;
      for (var i = 1; i < productsData.length; i++) {
        if (String(productsData[i][productsIdx.Article] || '').toLowerCase() === String(args.article).toLowerCase()) {
          productId = productsData[i][productsIdx.ID]; break;
        }
      }
      if (!productId) return fail_('Товар з артикулом "' + args.article + '" не знайдено.');
      return adjustStock(token, productId, Number(args.newQty), 'AI-асистент: ' + (args.reason || ''));
    }

    return fail_('Дія не реалізована.');
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Простий аналіз "простоїв" виробництва: виробничі замовлення, які довго
 * стоять запланованими (зарезервовані, але не запущені), або давно не
 * просувались по етапах — можливі причини затримок.
 */
function findProductionDelays_() {
  var sheet = getDb_().getSheetByName(SHEET_PRODUCTION_ORDERS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  var now = new Date();
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[idx.ID] || row[idx.Status] === 'completed') continue;
    var createdAt = new Date(row[idx.CreatedAt]);
    if (isNaN(createdAt.getTime())) continue;
    var daysSinceCreated = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

    if (row[idx.Status] === 'planned' && daysSinceCreated >= 3) {
      result.push({ assemblyName: row[idx.AssemblyName], status: 'заплановано, не запущено', daysStuck: daysSinceCreated });
      continue;
    }
    if (row[idx.Status] === 'in_progress') {
      var history = [];
      try { history = JSON.parse(row[idx.StageHistoryJson] || '[]'); } catch (e) {}
      var lastStageAt = history.length ? new Date(history[history.length - 1].at) : createdAt;
      var daysSinceStage = Math.floor((now - lastStageAt) / (1000 * 60 * 60 * 24));
      if (daysSinceStage >= 3) {
        result.push({ assemblyName: row[idx.AssemblyName], status: 'в роботі, застрягло на етапі', daysStuck: daysSinceStage });
      }
    }
  }
  result.sort(function (a, b) { return b.daysStuck - a.daysStuck; });
  return result.slice(0, 20);
}

/**
 * Прогноз закупівель: дивимось на реальні списання товарів (з History) за
 * останні 60 днів, рахуємо середній темп витрати на день, і прогнозуємо,
 * через скільки днів залишок вичерпається та скільки варто замовити
 * (щоб вистачило на ще 30 днів роботи в тому ж темпі).
 */
function forecastPurchaseNeeds_(articleOrQuery) {
  var ss = getDb_();
  var historySheet = ss.getSheetByName(SHEET_HISTORY);
  var historyData = historySheet.getDataRange().getValues();
  var historyIdx = indexMap_(historyData[0]);

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);

  var consumptionByArticle = {}; // article -> {totalOut, name}
  for (var i = 1; i < historyData.length; i++) {
    var row = historyData[i];
    var qty = Number(row[historyIdx.Qty]) || 0;
    if (qty >= 0) continue; // цікавить лише списання (від'ємні), не прихід
    var ts = new Date(row[historyIdx.Timestamp]);
    if (isNaN(ts.getTime()) || ts < cutoff) continue;
    var article = String(row[historyIdx.Article] || '').trim();
    if (!article) continue;
    if (!consumptionByArticle[article]) consumptionByArticle[article] = { totalOut: 0, name: row[historyIdx.Name] };
    consumptionByArticle[article].totalOut += Math.abs(qty);
  }

  var productsSheet = ss.getSheetByName(SHEET_PRODUCTS);
  var productsData = productsSheet.getDataRange().getValues();
  var productsIdx = indexMap_(productsData[0]);
  var productByArticle = {};
  for (var p = 1; p < productsData.length; p++) {
    var article2 = String(productsData[p][productsIdx.Article] || '');
    if (article2) productByArticle[article2] = rowToProduct_(productsData[p], productsIdx);
  }

  var q = String(articleOrQuery || '').toLowerCase().trim();
  var result = [];
  Object.keys(consumptionByArticle).forEach(function (article) {
    if (q && article.toLowerCase().indexOf(q) === -1 && String(consumptionByArticle[article].name || '').toLowerCase().indexOf(q) === -1) return;
    var product = productByArticle[article];
    if (!product) return;
    var dailyRate = consumptionByArticle[article].totalOut / 60;
    if (dailyRate <= 0) return;
    var daysUntilEmpty = Math.round(product.qty / dailyRate);
    var suggestedOrderQty = Math.ceil(dailyRate * 30); // на 30 днів наперед
    result.push({
      article: article, name: product.name, currentQty: product.qty,
      avgDailyConsumption: round2_(dailyRate), daysUntilEmpty: daysUntilEmpty, suggestedOrderQty: suggestedOrderQty
    });
  });

  result.sort(function (a, b) { return a.daysUntilEmpty - b.daysUntilEmpty; });
  return result.slice(0, 25);
}

function getLowStockProducts_internal_() {
  var sheet = getDb_().getSheetByName(SHEET_PRODUCTS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  var items = [];
  for (var i = 1; i < data.length; i++) {
    var p = rowToProduct_(data[i], idx);
    if (p.article && p.minQty > 0 && p.qty < p.minQty) items.push({ article: p.article, name: p.name, qty: p.qty, minQty: p.minQty });
  }
  return items;
}

/**
 * Головна точка входу — повноцінний AI-асистент із доступом до всієї системи.
 * historyJson — попередні репліки діалогу (щоб пам'ятав контекст розмови),
 * необов'язково.
 */
function askFullAssistant(token, question, historyJson, fileBase64, fileMimeType) {
  try {
    var user = requireAuth_(token);
    user.token_ = token; // для внутрішніх викликів інструментів
    if (!question || !question.trim()) return fail_('Введіть запитання.');

    var systemText =
      'Ти — повноцінний AI-асистент системи складського обліку й виробництва "SH ERP". Ти вмієш: ' +
      'відповідати на питання про систему; знаходити товари й виробничі замовлення; аналізувати виробництво; ' +
      'будувати звіти (Excel/PDF); прогнозувати нестачу матеріалів; знаходити причини простоїв виробництва; ' +
      'відповідати на будь-які питання щодо даних системи. ' +
      'У тебе є інструменти для отримання РЕАЛЬНИХ даних — використовуй їх щоразу, коли потрібні конкретні дані, не вигадуй нічого сам. ' +
      'Деякі інструменти є КРИТИЧНИМИ діями (зміна залишків тощо) — вони НІКОЛИ не виконуються одразу, система сама покаже користувачу підтвердження; ти просто повідомляєш, що саме пропонуєш зробити. ' +
      'Якщо користувач прикріпив зображення чи документ — уважно проаналізуй його вміст і дай корисну відповідь по суті. ' +
      'Відповідай українською мовою, по суті, стисло (це може озвучуватись голосом). Коли створюєш файл — обов\'язково згадай посилання на нього.';

    var contents = [];
    if (historyJson) {
      try { contents = JSON.parse(historyJson); } catch (e) { contents = []; }
    }
    var userParts = [{ text: (contents.length ? '' : systemText + '\n\n') + question }];
    if (fileBase64 && fileMimeType) userParts.push({ inline_data: { mime_type: fileMimeType, data: fileBase64 } });
    contents.push({ role: 'user', parts: userParts });

    var maxIterations = 6;
    for (var iter = 0; iter < maxIterations; iter++) {
      var modelContent = callGeminiWithTools_(contents);
      contents.push(modelContent);

      var functionCalls = (modelContent.parts || []).filter(function (p) { return p.functionCall; });
      if (!functionCalls.length) {
        var textPart = (modelContent.parts || []).filter(function (p) { return p.text; })[0];
        return ok_({ answer: textPart ? textPart.text : '(порожня відповідь)', history: JSON.stringify(contents) });
      }

      var responseParts = functionCalls.map(function (fc) {
        var result;
        try { result = executeAiTool_(fc.functionCall.name, fc.functionCall.args || {}, user); }
        catch (e) { result = { error: e.message }; }
        return { functionResponse: { name: fc.functionCall.name, response: result }, _raw: result };
      });

      // Якщо будь-який виклик вимагає підтвердження — зупиняємось ТУТ і
      // повертаємо користувачу точні (не переказані Gemini) дані дії.
      var pending = responseParts.filter(function (rp) { return rp._raw && rp._raw.status === 'needs_confirmation'; })[0];
      if (pending) {
        // Gemini API вимагає role: 'user' для повідомлень з functionResponse —
        // роль 'function' більше НЕ приймається (Gemini повертав 400 "Role
        // 'function' is not supported"). Це саме та помилка, яку бачив власник.
        contents.push({ role: 'user', parts: responseParts.map(function (rp) { return { functionResponse: rp.functionResponse }; }) });
        return ok_({
          answer: '⚠️ Ця дія потребує підтвердження: ' + pending._raw.description,
          pendingConfirmation: { action: pending._raw.action, args: pending._raw.args, description: pending._raw.description },
          history: JSON.stringify(contents)
        });
      }

      contents.push({ role: 'user', parts: responseParts.map(function (rp) { return { functionResponse: rp.functionResponse }; }) });
    }

    return fail_('Забагато кроків для відповіді — спробуйте перефразувати запитання простіше.');
  } catch (e) {
    return fail_(e.message);
  }
}
