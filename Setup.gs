/**
 * Setup.gs — ініціалізація бази даних (аркуші, заголовки, стартові користувачі).
 * Виконується автоматично при першому запуску (doGet) та може бути
 * запущена вручну функцією setupDatabase() з редактора Apps Script.
 */

var PRODUCT_HEADERS = [
  'ID', 'Article', 'Code', 'Name', 'Description',
  'Category', 'ProductGroup', 'Family', 'Type', 'Kind', 'ProductLine', 'Barcode',
  'Unit', 'UnitsPerPackage', 'Cell', 'Qty', 'MinQty',
  'LocalPriceExclVat', 'LocalPriceInclVat', 'GermanPriceExclVat', 'GermanPriceInclVat', 'SellPriceEUR',
  'WeightPerUnitKg', 'WarrantyMonths', 'Status',
  'Manufacturer', 'ManufacturerCode', 'CountryOfOrigin',
  'PriceListRef', 'Note', 'PhotoUrl', 'QrUrl', 'CreatedAt', 'UpdatedAt', 'DefaultSupplierId'
];

// Підвищуйте цю версію лише коли реально змінюєте схему (додаєте аркуш/стовпець) —
// це запобігає повторній дорогій перевірці схеми на КОЖНОМУ завантаженні сторінки.
var SCHEMA_VERSION_ = '22';

function ensureDatabase_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SCHEMA_VERSION') === SCHEMA_VERSION_) {
    return; // вже перевірено й змігровано раніше — пропускаємо всі важкі операції
  }

  try {
    var ss = getDb_();

    ensureSheet_(ss, SHEET_USERS, ['ID', 'Login', 'PasswordHash', 'Role', 'FullName', 'Active', 'CreatedAt']);
    ensureSheet_(ss, SHEET_PRODUCTS, PRODUCT_HEADERS);
    ensureSheet_(ss, SHEET_HISTORY, ['Timestamp', 'User', 'Action', 'Article', 'Name', 'Qty', 'Comment']);
    ensureSheet_(ss, SHEET_UNITS, ['Name']);
    ensureSheet_(ss, SHEET_SETTINGS, ['Key', 'Value']);
    ensureSheet_(ss, SHEET_ASSEMBLIES, [
      'ID', 'Name', 'Article', 'Note', 'PhotoUrl', 'CreatedAt', 'UpdatedAt',
      'LaborCostPerUnit', 'PackagingCostPerUnit', 'DeliveryCostPerUnit', 'OtherCostPerUnit',
      'DrawingFileUrl', 'DrawingFileName', 'DrawingMimeType', 'DrawingOriginalUrl', 'DefaultSupplierId'
    ]);
    ensureSheet_(ss, SHEET_ASSEMBLY_COMPONENTS, ['ID', 'AssemblyID', 'ProductID', 'Qty', 'WarehouseID', 'ComponentType', 'SubAssemblyID']);
    ensureSheet_(ss, SHEET_PRODUCTION_ORDERS, [
      'ID', 'AssemblyID', 'AssemblyName', 'UnitsPlanned', 'Status',
      'User', 'CreatedAt', 'CompletedAt', 'Comment', 'PickListJson',
      'TotalLocalCostEur', 'TotalGermanCostEur', 'CurrentStageIndex', 'StageHistoryJson', 'BOMVersionNumber',
      'LaborCostEur', 'PackagingCostEur', 'DeliveryCostEur', 'OtherCostEur', 'FullCostEur', 'AssignedWorkersJson'
    ]);
    ensureSheet_(ss, SHEET_PRODUCTION_STAGES, ['ID', 'Name', 'SortOrder']);
    ensureSheet_(ss, SHEET_CUSTOMER_ORDERS, [
      'ID', 'OrderNumber', 'ClientName', 'ContactPerson', 'Deadline', 'Priority', 'Status',
      'DocumentFileUrl', 'DocumentFileName', 'Comment', 'CreatedBy', 'CreatedAt'
    ]);
    ensureSheet_(ss, SHEET_CUSTOMER_ORDER_ITEMS, ['ID', 'CustomerOrderID', 'AssemblyID', 'AssemblyName', 'Qty', 'ProductionOrderID']);
    ensureSheet_(ss, SHEET_FINISHED_GOODS, [
      'ID', 'SerialNumber', 'AssemblyID', 'AssemblyName', 'ProductionOrderID',
      'ManufactureDate', 'Status', 'CustomerOrderID', 'Comment',
      'UnitCostLocalEur', 'UnitCostGermanEur', 'ConsumedInProductionOrderID'
    ]);
    ensureSheet_(ss, SHEET_ASSEMBLY_VERSIONS, ['ID', 'AssemblyID', 'VersionNumber', 'ComponentsJson', 'CreatedAt', 'CreatedBy']);
    ensureSheet_(ss, SHEET_INVENTORY_SESSIONS, ['ID', 'Name', 'Status', 'StartedBy', 'StartedAt', 'CompletedAt', 'Comment']);
    ensureSheet_(ss, SHEET_INVENTORY_ITEMS, [
      'ID', 'InventorySessionID', 'ProductID', 'Article', 'ProductName',
      'ExpectedQty', 'ActualQty', 'Counted'
    ]);
    ensureSheet_(ss, SHEET_QC_CHECKLIST, ['ID', 'Name', 'SortOrder']);
    ensureSheet_(ss, SHEET_QC_CHECKS, [
      'ID', 'FinishedGoodID', 'SerialNumber', 'ChecklistJson', 'PhotoUrl',
      'Result', 'Inspector', 'CheckedAt', 'Comment'
    ]);
    ensureSheet_(ss, SHEET_SHIPMENTS, [
      'ID', 'Carrier', 'WaybillNumber', 'PackageCount', 'Weight', 'Dimensions',
      'PhotoUrl', 'ShipDate', 'DeliveryDate', 'Status', 'CustomerOrderID', 'Comment', 'CreatedBy', 'CreatedAt'
    ]);
    ensureSheet_(ss, SHEET_SHIPMENT_ITEMS, ['ID', 'ShipmentID', 'FinishedGoodID', 'SerialNumber']);
    ensureSheet_(ss, SHEET_EMPLOYEES, ['ID', 'FullName', 'Position', 'Phone', 'PhotoUrl', 'HireDate', 'Status', 'Notes']);
    ensureSheet_(ss, SHEET_PAYROLL_ENTRIES, [
      'ID', 'EmployeeID', 'Type', 'ProductionOrderID', 'AssemblyName', 'UnitsProduced',
      'Amount', 'EntryDate', 'Comment', 'CreatedBy', 'CreatedAt'
    ]);
    ensureSheet_(ss, SHEET_SUPPLIERS, ['ID', 'Name', 'ContactPerson', 'Phone', 'Email', 'Notes', 'CreatedAt']);
    ensureSheet_(ss, SHEET_TELEGRAM_USERS, ['ChatID', 'UserID', 'Login', 'Role', 'FullName', 'LinkedAt']);
    ensureSheet_(ss, SHEET_WAREHOUSES, ['ID', 'Name', 'IsDefault', 'CreatedAt']);
    ensureSheet_(ss, SHEET_WAREHOUSE_STOCK, ['ID', 'ProductID', 'WarehouseID', 'Qty']);
    ensureSheet_(ss, SHEET_PURCHASE_ORDERS, [
      'ID', 'Supplier', 'SupplierId', 'Status', 'OrderDate', 'ExpectedDeliveryDate',
      'InvoiceFileUrl', 'InvoiceFileName', 'Comment', 'CreatedBy', 'CreatedAt', 'SourceCustomerOrderID'
    ]);
    ensureSheet_(ss, SHEET_PURCHASE_ORDER_ITEMS, [
      'ID', 'PurchaseOrderID', 'Article', 'ProductName', 'QtyOrdered', 'QtyReceived', 'ExpectedPrice', 'ActualPrice'
    ]);

    // Кожен наступний крок — у власному try/catch: якщо один крок зазнає
    // помилки (наприклад, через нетипову структуру таблиці після ручного
    // редагування), решта кроків все одно виконається, і застосунок
    // не застрягне в повільному режимі перевірки схеми назавжди.
    safeStep_(function () { ensureColumnsExist_(ss.getSheetByName(SHEET_ASSEMBLIES), [
      'ID', 'Name', 'Article', 'Note', 'PhotoUrl', 'CreatedAt', 'UpdatedAt',
      'LaborCostPerUnit', 'PackagingCostPerUnit', 'DeliveryCostPerUnit', 'OtherCostPerUnit',
      'DrawingFileUrl', 'DrawingFileName', 'DrawingMimeType', 'DrawingOriginalUrl', 'DefaultSupplierId'
    ]); });
    safeStep_(function () { ensureColumnsExist_(ss.getSheetByName(SHEET_PRODUCTION_ORDERS), [
      'ID', 'AssemblyID', 'AssemblyName', 'UnitsPlanned', 'Status',
      'User', 'CreatedAt', 'CompletedAt', 'Comment', 'PickListJson',
      'TotalLocalCostEur', 'TotalGermanCostEur', 'CurrentStageIndex', 'StageHistoryJson', 'BOMVersionNumber',
      'LaborCostEur', 'PackagingCostEur', 'DeliveryCostEur', 'OtherCostEur', 'FullCostEur', 'AssignedWorkersJson'
    ]); });
    safeStep_(function () { seedDefaultStagesIfEmpty_(ss); });
    safeStep_(function () { seedDefaultQCChecklistIfEmpty_(ss); });
    safeStep_(function () { ensureColumnsExist_(ss.getSheetByName(SHEET_PURCHASE_ORDERS), [
      'ID', 'Supplier', 'SupplierId', 'Status', 'OrderDate', 'ExpectedDeliveryDate',
      'InvoiceFileUrl', 'InvoiceFileName', 'Comment', 'CreatedBy', 'CreatedAt', 'SourceCustomerOrderID'
    ]); });
    safeStep_(function () { ensureColumnsExist_(ss.getSheetByName(SHEET_PURCHASE_ORDER_ITEMS), [
      'ID', 'PurchaseOrderID', 'Article', 'ProductName', 'QtyOrdered', 'QtyReceived', 'ExpectedPrice', 'ActualPrice'
    ]); });
    safeStep_(function () { ensureColumnsExist_(ss.getSheetByName(SHEET_FINISHED_GOODS), [
      'ID', 'SerialNumber', 'AssemblyID', 'AssemblyName', 'ProductionOrderID',
      'ManufactureDate', 'Status', 'CustomerOrderID', 'Comment',
      'UnitCostLocalEur', 'UnitCostGermanEur', 'ConsumedInProductionOrderID'
    ]); });
    safeStep_(function () { migrateProductsSchema_(ss); });
    safeStep_(function () { ensureColumnsExist_(ss.getSheetByName(SHEET_PRODUCTS), PRODUCT_HEADERS); });
    safeStep_(function () { seedUnitsIfEmpty_(ss); });
    safeStep_(function () { seedUsersIfEmpty_(ss); });
    safeStep_(function () { seedVatRateIfEmpty_(ss); });
    safeStep_(function () { ensureColumnsExist_(ss.getSheetByName(SHEET_WAREHOUSES), ['ID', 'Name', 'IsDefault', 'CreatedAt']); });
    safeStep_(function () { seedDefaultWarehouseIfEmpty_(ss); });
    safeStep_(function () { ensureColumnsExist_(ss.getSheetByName(SHEET_ASSEMBLY_COMPONENTS), ['ID', 'AssemblyID', 'ProductID', 'Qty', 'WarehouseID', 'ComponentType', 'SubAssemblyID']); });

    // Прибираємо стандартний "Sheet1", якщо існує і порожній
    var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Аркуш1');
    if (def && ss.getSheets().length > 1) {
      try { ss.deleteSheet(def); } catch (e) {}
    }
  } catch (e) {
    // Навіть у разі серйозної помилки — не блокуємо весь застосунок нею,
    // просто логуємо, застосунок працюватиме з тим, що вже є в таблиці.
    Logger.log('ensureDatabase_ error: ' + e.message);
  }

  // ВАЖЛИВО: прапорець версії ставимо завжди, навіть якщо якийсь крок вище
  // не вдався — інакше наступне відкриття знову запускало б повну (повільну)
  // перевірку схеми, і так щоразу.
  props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION_);
}

function safeStep_(fn) {
  try { fn(); } catch (e) { Logger.log('ensureDatabase_ step failed: ' + e.message); }
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var needsHeader = firstRow.join('') === '';
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

/**
 * Загальна безпечна міграція: додає в кінець аркуша будь-які відсутні
 * стовпці зі списку requiredHeaders, НЕ чіпаючи наявні дані/стовпці.
 * Дозволяє безпечно розширювати схему товару новими полями з часом.
 */
function ensureColumnsExist_(sheet, requiredHeaders) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  requiredHeaders.forEach(function (h) {
    if (headers.indexOf(h) === -1) {
      var newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(h).setFontWeight('bold');
      headers.push(h);
    }
  });
}

function seedVatRateIfEmpty_(ss) {
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === 'VatRatePercent') return;
  }
  sheet.appendRow(['VatRatePercent', 20]);
}

function seedDefaultQCChecklistIfEmpty_(ss) {
  var sheet = ss.getSheetByName(SHEET_QC_CHECKLIST);
  if (sheet.getLastRow() > 1) return;
  var defaults = ['Розміри відповідають кресленню', 'Немає видимих пошкоджень', 'Зварні шви якісні', 'Комплектність повна', 'Пакування відповідає вимогам'];
  defaults.forEach(function (name, i) { sheet.appendRow([newId_(), name, i]); });
}

function seedDefaultStagesIfEmpty_(ss) {
  var sheet = ss.getSheetByName(SHEET_PRODUCTION_STAGES);
  if (sheet.getLastRow() > 1) return;
  var defaults = ['Розкрій', 'Обробка', 'Зварювання/збірка', 'Фарбування', 'Пакування'];
  defaults.forEach(function (name, i) { sheet.appendRow([newId_(), name, i]); });
}

function seedDefaultWarehouseIfEmpty_(ss) {
  var sheet = ss.getSheetByName(SHEET_WAREHOUSES);
  if (sheet.getLastRow() <= 1) {
    sheet.appendRow([newId_(), 'Основний склад', true, nowStr_()]);
    return;
  }
  // Апгрейд існуючих інсталяцій: якщо жоден склад ще не позначений як
  // основний (стовпець IsDefault з'явився пізніше) — позначаємо перший.
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  var hasDefault = false;
  for (var i = 1; i < data.length; i++) {
    if (data[i][idx.IsDefault] === true) { hasDefault = true; break; }
  }
  if (!hasDefault && data.length > 1) {
    sheet.getRange(2, idx.IsDefault + 1).setValue(true);
  }
}

/**
 * Міграція старих таблиць (створених до появи двох цін постачальників):
 * якщо в аркуші "Products" є стовпець "PurchasePrice" замість "LocalPriceEUR",
 * перейменовуємо його і додаємо порожній стовпець "GermanPriceEUR".
 */
function migrateProductsSchema_(ss) {
  var sheet = ss.getSheetByName(SHEET_PRODUCTS);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var priceIdx = headers.indexOf('PurchasePrice');
  if (priceIdx !== -1) {
    sheet.getRange(1, priceIdx + 1).setValue('LocalPriceEUR');
    if (headers.indexOf('GermanPriceEUR') === -1) {
      sheet.insertColumnAfter(priceIdx + 1);
      sheet.getRange(1, priceIdx + 2).setValue('GermanPriceEUR');
    }
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  // Стара модель мала одну ціну на постачальника з розрахунком ПДВ за єдиною
  // ставкою. Нова модель — 4 окремі поля (з ПДВ і без — для кожного
  // постачальника), щоб суми точно збігались із рахунками. Стару ціну
  // переносимо як "з ПДВ", поле "без ПДВ" лишаємо порожнім для ручного заповнення.
  var localOldIdx = headers.indexOf('LocalPriceEUR');
  if (localOldIdx !== -1 && headers.indexOf('LocalPriceInclVat') === -1) {
    sheet.getRange(1, localOldIdx + 1).setValue('LocalPriceInclVat');
  }
  var germanOldIdx = headers.indexOf('GermanPriceEUR');
  if (germanOldIdx !== -1 && headers.indexOf('GermanPriceInclVat') === -1) {
    sheet.getRange(1, germanOldIdx + 1).setValue('GermanPriceInclVat');
  }
}

function seedUnitsIfEmpty_(ss) {
  var sheet = ss.getSheetByName(SHEET_UNITS);
  if (sheet.getLastRow() > 1) return;
  var defaults = ['шт', 'уп', 'кг', 'м', 'рулон', 'комплект'];
  var rows = defaults.map(function (u) { return [u]; });
  sheet.getRange(2, 1, rows.length, 1).setValues(rows);
}

function seedUsersIfEmpty_(ss) {
  var sheet = ss.getSheetByName(SHEET_USERS);
  if (sheet.getLastRow() > 1) return;

  var rows = [
    [newId_(), 'admin', hashPassword_('admin123'), 'admin', 'Адміністратор', true, nowStr_()],
    [newId_(), 'sklad', hashPassword_('sklad123'), 'storekeeper', 'Комірник', true, nowStr_()],
    [newId_(), 'view1', hashPassword_('view123'), 'viewer', 'Перегляд 1', true, nowStr_()],
    [newId_(), 'view2', hashPassword_('view123'), 'viewer', 'Перегляд 2', true, nowStr_()],
    [newId_(), 'view3', hashPassword_('view123'), 'viewer', 'Перегляд 3', true, nowStr_()]
  ];
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Ручний запуск ініціалізації з редактора Apps Script (за потреби).
 */
function setupDatabase() {
  PropertiesService.getScriptProperties().deleteProperty('SCHEMA_VERSION'); // примусово перевіряємо все заново
  ensureDatabase_();
  Logger.log('База даних SHСклад готова. ID таблиці: ' + getDb_().getId());
}

/**
 * ОДНОРАЗОВИЙ РЕМОНТ (запустити вручну з редактора Apps Script: Run → repairAssemblyCostColumns).
 *
 * У стовпцях "Праця/Пакування/Доставка/Інше" (аркуш Assemblies) деякі клітинки
 * випадково отримали формат Дата/Час замість Числа. Google Таблиці тоді
 * зберігають 0 як "31.12.1899" — і Apps Script читає це не як число 0,
 * а як об'єкт Date. Якщо потім цю дату наївно перевести в число (Number(дата)),
 * виходить величезна від'ємна кількість мілісекунд — саме ті "незрозумілі
 * від'ємні суми", які власник побачив у картці виробу.
 *
 * Ця функція: 1) скидає формат усіх 4 стовпців на звичайне число,
 * 2) обнуляє будь-які клітинки, де досі "застрягла" дата.
 * Після запуску собівартості з поламаними додатковими витратами (455714,
 * 455716, 264112, 280494, 409219.L і т.п. — усе, що показувало трильйони
 * від'ємних євро) повернуться до нормальних чисел (зазвичай 0 — власнику
 * потрібно буде наново ввести реальні суми Праці/Пакування/Доставки/Іншого
 * для тих виробів, де вони справді були потрібні).
 */
function repairAssemblyCostColumns() {
  var sheet = getDb_().getSheetByName(SHEET_ASSEMBLIES);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  var cols = ['LaborCostPerUnit', 'PackagingCostPerUnit', 'DeliveryCostPerUnit', 'OtherCostPerUnit'];
  var lastRow = sheet.getLastRow();

  // Крок 1: формат усього стовпця (під заголовком) на звичайне число.
  cols.forEach(function (colName) {
    var col = idx[colName];
    if (col == null || lastRow < 2) return;
    sheet.getRange(2, col + 1, lastRow - 1, 1).setNumberFormat('0.00');
  });

  // Крок 2: перечитуємо дані ПІСЛЯ зміни формату і обнуляємо все, що досі Date.
  var fixedCells = [];
  var data2 = sheet.getDataRange().getValues();
  for (var i = 1; i < data2.length; i++) {
    cols.forEach(function (colName) {
      var col = idx[colName];
      if (col == null) return;
      var v = data2[i][col];
      if (v instanceof Date || (typeof v === 'number' && Math.abs(v) > 1e9)) {
        sheet.getRange(i + 1, col + 1).setValue(0);
        fixedCells.push(data2[i][idx.Name] + ' / ' + colName);
      }
    });
  }

  Logger.log('Виправлено клітинок: ' + fixedCells.length);
  Logger.log(fixedCells.join('\n'));
  return fixedCells.length;
}
