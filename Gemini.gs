/**
 * Gemini.gs — інтеграція зі штучним інтелектом Gemini.
 *
 * Два застосування:
 * 1. Розпізнавання накладних постачальників (фото/скан → список позицій)
 * 2. Довідник — чат-асистент, що відповідає ТІЛЬКИ на основі написаної
 *    інструкції нижче (не бачить реальних даних бази, тому не може
 *    "вигадати" неправильну відповідь про ваші фактичні залишки чи замовлення).
 */

function getGeminiApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
}

function saveGeminiApiKey(token, apiKey) {
  try {
    requireRole_(token, ['admin']);
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', (apiKey || '').trim());
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

function getGeminiStatus(token) {
  try {
    requireAuth_(token);
    return ok_({ configured: !!getGeminiApiKey_() });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Внутрішній виклик до Gemini API. parts — масив частин запиту
 * (текст і/або зображення), як цього вимагає Gemini API.
 */
function callGemini_(parts) {
  var apiKey = getGeminiApiKey_();
  if (!apiKey) throw new Error('Gemini API ключ не налаштовано. Додайте його в Налаштування → AI (тільки admin).');

  // Використовуємо ПСЕВДОНІМ "gemini-flash-latest" замість конкретної версії —
  // Google сам перенаправляє його на актуальну рекомендовану модель Flash,
  // тому інтеграція не ламається щоразу, коли з'являється нове покоління
  // (а це, судячи з усього, відбувається в Google дуже часто).
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;
  var json = fetchGeminiJson_(url, { contents: [{ parts: parts }] });
  var text = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0].text;
  if (!text) throw new Error('Gemini не повернув відповідь (можливо, заблоковано фільтром безпеки).');
  return text;
}

/**
 * Єдина точка фактичного HTTP-виклику Gemini generateContent — використовують
 * і callGemini_ (Довідник/розпізнавання накладних), і callGeminiWithTools_
 * (повноцінний AI-асистент, AI_FullAssistant.gs).
 *
 * Безкоштовний тариф Gemini API має ДУЖЕ малий ліміт запитів (напр. 20/хв) —
 * власник вже кілька разів бачив "429 Quota exceeded". Google у відповіді
 * сам підказує, скільки секунд чекати (RetryInfo.retryDelay) — тож при
 * такій помилці ми чекаємо рівно стільки (Utilities.sleep) і пробуємо ще
 * ОДИН раз, замість одразу показувати користувачу помилку. Якщо ліміт не
 * звільнився і вдруге — здаємось із людяним поясненням (це не баг, а межа
 * безкоштовного тарифу; постійне рішення — увімкнути платний тариф/Billing
 * для цього API-ключа в Google Cloud Console).
 */
function fetchGeminiJson_(url, payload) {
  var maxAttempts = 2;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    // Реальний HTTP-код відповіді — НАЙНАДІЙНІШИЙ сигнал "це ліміт" (429),
    // набагато надійніший за поля всередині JSON-тіла (json.error.status/code),
    // бо формат тіла помилки для різних типів квоти в Google різниться і не
    // завжди містить ті самі поля. Раніше перевірка спиралась ТІЛЬКИ на
    // json.error.status/code і не спрацювала для реальної помилки власника —
    // тому запит взагалі не повторювався.
    var httpCode = resp.getResponseCode();
    var text = resp.getContentText();
    var json;
    try { json = JSON.parse(text); } catch (e) { json = null; }

    var errMessage = (json && json.error && json.error.message) || text;
    var hasError = httpCode >= 400 || (json && json.error);
    if (hasError) {
      var isQuota = httpCode === 429 ||
        (json && json.error && (json.error.status === 'RESOURCE_EXHAUSTED' || Number(json.error.code) === 429)) ||
        /quota|rate.?limit/i.test(errMessage);
      if (isQuota && attempt < maxAttempts) {
        var delayMs = geminiRetryDelayMs_(json && json.error) || 5000;
        Utilities.sleep(Math.min(delayMs, 55000)); // не чекаємо довше 55с — лишаємось у безпечних межах виконання Apps Script
        continue;
      }
      if (isQuota) {
        throw new Error('Вичерпано безкоштовний ліміт запитів Gemini. Це межа безкоштовного тарифу Google (не помилка системи) — ' +
          'зачекайте хвилину-дві й спробуйте ще раз, або увімкніть платний тариф (Billing) для цього API-ключа в Google Cloud Console, щоб зняти обмеження. ' +
          'Деталі від Google: ' + errMessage);
      }
      throw new Error('Gemini: ' + errMessage);
    }
    if (!json) throw new Error('Gemini повернув невалідну відповідь.');
    return json;
  }
}

function geminiRetryDelayMs_(error) {
  try {
    var details = error.details || [];
    for (var i = 0; i < details.length; i++) {
      if (details[i].retryDelay) {
        var sec = parseFloat(String(details[i].retryDelay).replace('s', ''));
        if (!isNaN(sec)) return Math.ceil(sec * 1000) + 500; // +500мс запасу
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Розпізнавання накладної постачальника з фото/скану.
 * Повертає позиції зі спробою автоматично зіставити кожну з товаром у базі.
 */
function recognizeInvoiceWithAI(token, base64Image, mimeType) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);

    var prompt = 'Ти аналізуєш фото або скан накладної від постачальника складу. ' +
      'Витягни ВСІ товарні позиції з таблиці накладної. ' +
      'Поверни СУВОРО валідний JSON-масив, без жодного тексту до чи після нього, без markdown-огортання. ' +
      'Формат кожного елемента: {"name": "точна назва товару як у накладній", "qty": число}. ' +
      'Якщо кількість не вдається розпізнати — став 1. Накладна може бути українською, англійською або німецькою мовою.';

    var text = callGemini_([{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }]);
    var cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    var items = JSON.parse(cleaned);
    if (!Array.isArray(items)) throw new Error('Gemini повернув не список позицій.');

    var productsSheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var productsData = productsSheet.getDataRange().getValues();
    var productsIdx = indexMap_(productsData[0]);
    var products = [];
    for (var i = 1; i < productsData.length; i++) {
      if (productsData[i][productsIdx.ID]) {
        products.push({ article: String(productsData[i][productsIdx.Article] || ''), name: String(productsData[i][productsIdx.Name] || '') });
      }
    }

    var result = items.map(function (item) {
      var rawName = String(item.name || '').trim();
      var rawLower = rawName.toLowerCase();
      var match = products.find(function (p) { return p.name.toLowerCase() === rawLower; });
      if (!match) {
        match = products.find(function (p) {
          var pLower = p.name.toLowerCase();
          return rawLower.length > 3 && (pLower.indexOf(rawLower) !== -1 || rawLower.indexOf(pLower) !== -1);
        });
      }
      return {
        rawName: rawName,
        qty: Number(item.qty) || 1,
        matched: !!match,
        article: match ? match.article : '',
        matchedName: match ? match.name : ''
      };
    });

    return ok_(result);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Довідник — відповідає ЛИШЕ на основі інструкції нижче. Свідомо НЕ отримує
 * доступу до реальних даних бази (залишків, замовлень тощо) — тому це просте,
 * недороге й безпечне "як це зробити", а не аналітика по живих даних.
 */
var HELP_MANUAL_TEXT_ =
  'SH ERP — система управління складом і виробництвом.\n\n' +
  'РОЛІ: Адмін (повний доступ), Комірник (складські операції, без цін постачальників і зарплати), Перегляд (тільки перегляд).\n\n' +
  '1. ТОВАРИ: розділ "Товари" → "+ Новий товар". Поля: артикул, назва, категорія, 5 типів цін, мінімальний залишок, фото. Масовий імпорт — кнопка Excel-імпорту.\n' +
  '2. ПРИХІД ТОВАРУ: відкрити товар → "Прихід" → кількість. Або "Масовий прихід" для кількох позицій одразу. Або через замовлення постачальнику (пункт 6).\n' +
  '3. ВИРОБИ: розділ "Вироби" → "+ Новий виріб". Додаєте компоненти (товари АБО інші вироби) через пошук з фото. "Дати в роботу" — резервує компоненти (не списує фізично). "Запустити" в замовленні на виробництво — фізично списує компоненти, створює серійні номери готових одиниць, нараховує зарплату призначеним працівникам.\n' +
  '4. ЗАМОВЛЕННЯ КЛІЄНТІВ: розділ "Замовлення клієнтів" → створити з позиціями-виробами → кнопка "Створити виробничі замовлення" сама резервує компоненти під кожен виріб.\n' +
  '5. ПЕРЕВІРКА КОМПЛЕКТНОСТІ: на сторінці виробу, при введенні кількості для виробництва, система сама показує, чого не вистачає (товарів чи готових виробів-компонентів).\n' +
  '6. ЗАМОВЛЕННЯ ПОСТАЧАЛЬНИКАМ: розділ "Замовлення постачальникам" → кілька позицій в одному замовленні, можна прикріпити накладну. Прихід проводиться прямо з картки замовлення.\n' +
  '7. ВІРТУАЛЬНІ СКЛАДИ: розділ "Склади". Основний склад автоматично показує все, що не приписано явно до іншого складу.\n' +
  '8. ГОТОВІ ВИРОБИ: розділ "Готові вироби" — пошук за серійним номером, повна історія (з чого зроблено, для кого, контроль якості).\n' +
  '9. КОНТРОЛЬ ЯКОСТІ: на сторінці готового виробу → "Контроль якості" → чек-лист → "Прийнято" або "Повернути на доопрацювання".\n' +
  '10. ВІДВАНТАЖЕННЯ: розділ "Відвантаження" → додати вироби за серійним номером, перевізник, ТТН.\n' +
  '11. ІНВЕНТАРИЗАЦІЯ: розділ "Інвентаризація" → "Нова" → знімок поточних залишків → вписати фактичну кількість → "Завершити" автоматично коригує розбіжності.\n' +
  '12. ЗВІТИ: розділ "Звіти й аналітика" — що варто замовити, вартість складу (5 типів цін), виробництво по місяцях.\n' +
  '13. ПРАЦІВНИКИ Й ЗАРПЛАТА (тільки admin): картки працівників, відрядна оплата нараховується автоматично при запуску виробництва (розподіл за відсотками між призначеними), аванси/премії/штрафи — вручну.\n' +
  '14. ДРУК: аркуш видачі, специфікація виробу (з чекбоксами — що включати), етикетки — усі з вибором позицій перед друком.\n' +
  '15. НАЛАШТУВАННЯ (admin): користувачі, одиниці виміру, склади, етапи виробництва, чек-лист якості, брендування (свій логотип), Gemini AI ключ.';

/**
 * AI-порадник по КОНКРЕТНОМУ замовленню клієнта — на відміну від загального
 * довідника, тут Gemini отримує реальні дані цього замовлення (позиції,
 * статуси, вартість) і може дати конкретну відповідь чи навіть текст
 * документа (листа постачальнику, зведення для клієнта тощо).
 */
function askAboutCustomerOrder(token, customerOrderId, question) {
  try {
    var user = requireAuth_(token);
    if (!question || !question.trim()) return fail_('Введіть запитання.');

    var orderResult = getCustomerOrder(token, customerOrderId);
    if (!orderResult.success) return orderResult;
    var o = orderResult.data;

    var context = 'Дані замовлення клієнта в системі SH ERP:\n' +
      'Клієнт: ' + o.clientName + (o.orderNumber ? ', № ' + o.orderNumber : '') + '\n' +
      'Статус: ' + o.status + ', виконано: ' + o.percentComplete + '%\n' +
      'Дедлайн: ' + (o.deadline || 'не вказано') + ', пріоритет: ' + o.priority + '\n' +
      (o.comment ? 'Коментар: ' + o.comment + '\n' : '') +
      'Позиції:\n' + o.items.map(function (it) {
        return '- ' + it.assemblyName + ': ' + it.qty + ' шт, статус виробництва: ' + (it.productionOrderStatus || 'не створено') +
          (it.stageName ? ' (етап: ' + it.stageName + ')' : '') +
          (it.lineTotalLocal != null ? ', оціночна вартість: ' + it.lineTotalLocal + ' €' : '');
      }).join('\n') +
      (o.totalCostLocal != null ? '\nЗагальна оціночна вартість: ' + o.totalCostLocal + ' €' : '') +
      (o.actualCostLocal != null ? '\nФактичні витрати станом на зараз: ' + o.actualCostLocal + ' €' : '');

    var systemPrompt =
      'Ти — асистент системи складського обліку й виробництва "SH ERP", який допомагає з КОНКРЕТНИМ замовленням клієнта. ' +
      'Відповідай українською мовою, по суті, спираючись на дані нижче. ' +
      'Якщо просять скласти лист, звіт чи документ — просто напиши повний текст цього документа, без зайвих коментарів навколо. ' +
      'Якщо запитують щось, чого немає в даних нижче — чесно скажи, що такої інформації не маєш.\n\n' + context +
      '\n\n=== ЗАПИТАННЯ ===\n' + question;

    var answer = callGemini_([{ text: systemPrompt }]);
    return ok_({ answer: answer });
  } catch (e) {
    return fail_(e.message);
  }
}

function askHelpAssistant(token, question) {
  try {
    requireAuth_(token);
    if (!question || !question.trim()) return fail_('Введіть запитання.');

    var systemPrompt =
      'Ти — довідковий асистент системи "SH ERP" (склад і виробництво). ' +
      'Відповідай КОРОТКО, українською мовою, спираючись ВИКЛЮЧНО на інструкцію нижче. ' +
      'Не вигадуй кнопок, розділів чи функцій, яких немає в інструкції. ' +
      'Якщо відповіді в інструкції немає — чесно скажи, що не маєш такої інформації, і порадь звернутись до адміністратора. ' +
      'Не обговорюй нічого, що не стосується роботи із застосунком.\n\n=== ІНСТРУКЦІЯ ===\n' + HELP_MANUAL_TEXT_ +
      '\n\n=== ЗАПИТАННЯ КОРИСТУВАЧА ===\n' + question;

    var answer = callGemini_([{ text: systemPrompt }]);
    return ok_({ answer: answer });
  } catch (e) {
    return fail_(e.message);
  }
}
