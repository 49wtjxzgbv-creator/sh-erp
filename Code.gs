/**
 * SHСклад — головний файл.
 * Точка входу вебдодатку, підключення шаблонів, спільні утиліти.
 */

// ==== ГЛОБАЛЬНІ КОНСТАНТИ ====
var SHEET_USERS = 'Users';
var SHEET_PRODUCTS = 'Products';
var SHEET_HISTORY = 'History';
var SHEET_UNITS = 'Units';
var SHEET_SETTINGS = 'Settings';
var SHEET_ASSEMBLIES = 'Assemblies';
var SHEET_ASSEMBLY_COMPONENTS = 'AssemblyComponents';
var SHEET_PRODUCTION_ORDERS = 'ProductionOrders';
var SHEET_WAREHOUSES = 'Warehouses';
var SHEET_WAREHOUSE_STOCK = 'WarehouseStock';
var SHEET_PURCHASE_ORDERS = 'PurchaseOrders';
var SHEET_PURCHASE_ORDER_ITEMS = 'PurchaseOrderItems';
var SHEET_PRODUCTION_STAGES = 'ProductionStages';
var SHEET_CUSTOMER_ORDERS = 'CustomerOrders';
var SHEET_CUSTOMER_ORDER_ITEMS = 'CustomerOrderItems';
var SHEET_FINISHED_GOODS = 'FinishedGoods';
var SHEET_ASSEMBLY_VERSIONS = 'AssemblyVersions';
var SHEET_INVENTORY_SESSIONS = 'InventorySessions';
var SHEET_INVENTORY_ITEMS = 'InventoryItems';
var SHEET_QC_CHECKLIST = 'QCChecklist';
var SHEET_QC_CHECKS = 'QCChecks';
var SHEET_SHIPMENTS = 'Shipments';
var SHEET_SHIPMENT_ITEMS = 'ShipmentItems';
var SHEET_EMPLOYEES = 'Employees';
var SHEET_PAYROLL_ENTRIES = 'PayrollEntries';
var SHEET_SUPPLIERS = 'Suppliers';
var SHEET_TELEGRAM_USERS = 'TelegramUsers';

var SESSION_TTL_SEC = 60 * 60 * 8; // 8 годин

/**
 * Точка входу вебдодатку.
 */
function doGet(e) {
  ensureDatabase_(); // гарантує, що всі аркуші і адмін існують

  var template = HtmlService.createTemplateFromFile('index');
  // ScriptApp.getService().getUrl() повертає справжню адресу /exec цього
  // розгортання. Сторінка фактично рендериться у прихованому iframe на
  // іншому домені (script.googleusercontent.com), тому window.location.href
  // на клієнті НЕ дорівнює адресі /exec — її треба передати явно.
  template.apiUrl = ScriptApp.getService().getUrl();

  return template.evaluate()
    .setTitle('SH ERP')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setFaviconUrl('https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_48dp.png');
}

/**
 * Вставляє вміст іншого HTML-файлу (для CSS/JS/партиалів).
 * Використання в шаблонах: <?!= include('Style'); ?>
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Отримати активну електронну таблицю бази даних.
 * Якщо скрипт прив'язаний до таблиці — використовує її,
 * інакше створює/знаходить таблицю "SHSklad_DB" у Google Drive
 * та зберігає її ID в Script Properties.
 */
function getDb_() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('DB_SPREADSHEET_ID');
  var ss;

  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    ss = null;
  }

  if (ss) return ss;

  if (ssId) {
    try {
      return SpreadsheetApp.openById(ssId);
    } catch (err) {
      // ID застарів, створимо нову
    }
  }

  var newSs = SpreadsheetApp.create('SHSklad_DB');
  props.setProperty('DB_SPREADSHEET_ID', newSs.getId());
  return newSs;
}

/**
 * Отримати (або створити) папку Google Drive для фото товарів.
 */
function getPhotosFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('PHOTOS_FOLDER_ID');

  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (err) {
      // не знайдено, створимо заново
    }
  }

  var folder = DriveApp.createFolder('SHSklad_Photos');
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  props.setProperty('PHOTOS_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * Уніфікована відповідь для всіх серверних функцій.
 */
function ok_(data) {
  return { success: true, data: data };
}
function fail_(message) {
  return { success: false, error: String(message) };
}

/**
 * doPost — надійна альтернатива google.script.run.
 *
 * Механізм google.script.run передає відповіді через прихований iframe
 * (google.script.host), і в деяких браузерах/мережах ця відповідь губиться
 * ще до того, як досягає сторінки, хоча сервер відпрацював коректно.
 * doPost обходить цей місток: клієнт надсилає звичайний fetch(POST) на
 * ту саму адресу застосунку, а не через iframe-канал.
 *
 * Тіло запиту: {"fn": "getStats", "args": [token, ...]}
 * Виконує лише функції з явного переліку нижче (білий список) —
 * ніякий довільний код клієнт викликати не може.
 */
var API_WHITELIST_ = {
  login: login, logout: logout, checkSession: checkSession, changeOwnPassword: changeOwnPassword,
  listUsers: listUsers, createUser: createUser, updateUser: updateUser, deleteUser: deleteUser,
  listProducts: listProducts, searchProducts: searchProducts, getProduct: getProduct,
  getFilterOptions: getFilterOptions,
  createProduct: createProduct, updateProduct: updateProduct, deleteProduct: deleteProduct,
  deleteProductsBulk: deleteProductsBulk,
  receiveStock: receiveStock, bulkReceiveStock: bulkReceiveStock, issueStock: issueStock, adjustStock: adjustStock, moveStock: moveStock,
  getHistory: getHistory, getProductHistory: getProductHistory,
  uploadProductPhoto: uploadProductPhoto, deleteProductPhoto: deleteProductPhoto,
  getQrPrintData: getQrPrintData, findProductByArticle: findProductByArticle,
  importProducts: importProducts, previewImportColumns: previewImportColumns, exportProducts: exportProducts,
  listUnits: listUnits, addUnit: addUnit, deleteUnit: deleteUnit,
  getVatRate: getVatRate, setVatRate: setVatRate,
  getLowStockProducts: getLowStockProducts, getStats: getStats, getBootstrapData: getBootstrapData,
  getDashboardWidgetsConfig: getDashboardWidgetsConfig, setDashboardWidgetsConfig: setDashboardWidgetsConfig,
  createBackup: createBackup, listBackups: listBackups,
  listAssemblies: listAssemblies, getAssembly: getAssembly, saveAssembly: saveAssembly,
  deleteAssembly: deleteAssembly, produceAssembly: produceAssembly,
  uploadAssemblyPhoto: uploadAssemblyPhoto, deleteAssemblyPhoto: deleteAssemblyPhoto,
  uploadAssemblyDrawing: uploadAssemblyDrawing, deleteAssemblyDrawing: deleteAssemblyDrawing,
  listProductionOrders: listProductionOrders, createProductionOrder: createProductionOrder,
  startProductionOrder: startProductionOrder, cancelProductionOrder: cancelProductionOrder,
  getProductionOrderPickList: getProductionOrderPickList, exportProductionOrders: exportProductionOrders,
  listWarehouses: listWarehouses, createWarehouse: createWarehouse, deleteWarehouse: deleteWarehouse,
  getWarehouseBreakdown: getWarehouseBreakdown, getWarehouseContents: getWarehouseContents,
  listPurchaseOrders: listPurchaseOrders, getPurchaseOrder: getPurchaseOrder, createPurchaseOrder: createPurchaseOrder,
  updatePurchaseOrderStatus: updatePurchaseOrderStatus, deletePurchaseOrder: deletePurchaseOrder,
  receiveFromPurchaseOrder: receiveFromPurchaseOrder,
  listProductionStages: listProductionStages, saveProductionStages: saveProductionStages,
  advanceProductionStage: advanceProductionStage, writeOffDefect: writeOffDefect,
  getReorderSuggestions: getReorderSuggestions, getWarehouseValueReport: getWarehouseValueReport,
  getProductionReport: getProductionReport, getReportsData: getReportsData,
  listCustomerOrders: listCustomerOrders, getCustomerOrder: getCustomerOrder,
  createCustomerOrder: createCustomerOrder, updateCustomerOrderStatus: updateCustomerOrderStatus,
  deleteCustomerOrder: deleteCustomerOrder, createProductionOrdersFromCustomerOrder: createProductionOrdersFromCustomerOrder,
  checkAssemblyAvailability: checkAssemblyAvailability, getAssemblyEstimatedCost: getAssemblyEstimatedCost,
  listFinishedGoods: listFinishedGoods, getFinishedGoodBySerial: getFinishedGoodBySerial,
  updateFinishedGoodStatus: updateFinishedGoodStatus,
  listAssemblyVersions: listAssemblyVersions,
  createInventorySession: createInventorySession, listInventorySessions: listInventorySessions,
  getInventorySession: getInventorySession, setInventoryItemActual: setInventoryItemActual,
  completeInventorySession: completeInventorySession, deleteInventorySession: deleteInventorySession,
  listQCChecklist: listQCChecklist, saveQCChecklist: saveQCChecklist, performQualityCheck: performQualityCheck,
  listQualityChecks: listQualityChecks, getQualityCheck: getQualityCheck,
  listShipments: listShipments, getShipment: getShipment, createShipment: createShipment,
  markShipmentDelivered: markShipmentDelivered, deleteShipment: deleteShipment,
  listEmployees: listEmployees, saveEmployee: saveEmployee, uploadEmployeePhoto: uploadEmployeePhoto,
  deleteEmployee: deleteEmployee,
  addPayrollEntry: addPayrollEntry, deletePayrollEntry: deletePayrollEntry,
  getEmployeePayroll: getEmployeePayroll, getPayrollSummaryReport: getPayrollSummaryReport,
  getBrandingAssets: getBrandingAssets, uploadBrandingAsset: uploadBrandingAsset, deleteBrandingAsset: deleteBrandingAsset,
  saveGeminiApiKey: saveGeminiApiKey, getGeminiStatus: getGeminiStatus,
  recognizeInvoiceWithAI: recognizeInvoiceWithAI, askHelpAssistant: askHelpAssistant, askAboutCustomerOrder: askAboutCustomerOrder,
  askFullAssistant: askFullAssistant, confirmAiAction: confirmAiAction,
  installDailyDigestTrigger: installDailyDigestTrigger, removeDailyDigestTrigger: removeDailyDigestTrigger, getDailyDigestStatus: getDailyDigestStatus,
  listSuppliers: listSuppliers, saveSupplier: saveSupplier, deleteSupplier: deleteSupplier,
  previewSupplierRequestsFromCustomerOrder: previewSupplierRequestsFromCustomerOrder,
  createPurchaseOrdersFromGroups: createPurchaseOrdersFromGroups,
  createProductionOrderForItem: createProductionOrderForItem,
  saveTelegramBotToken: saveTelegramBotToken, getTelegramStatus: getTelegramStatus,
  installTelegramPollingTrigger: installTelegramPollingTrigger, removeTelegramPollingTrigger: removeTelegramPollingTrigger,
  listTelegramLinkedUsers: listTelegramLinkedUsers, unlinkTelegramUser: unlinkTelegramUser
};

// Telegram більше НЕ використовує doPost як вебхук (Apps Script Web App
// віддає 302 на POST /exec, а Telegram не йде за редиректами при перевірці
// відповіді вебхука — тому вебхук-підхід ніколи не міг стабільно
// працювати; деталі й фактична реалізація — Telegram.gs, pollTelegramUpdates_,
// яка сама щохвилини опитує Telegram замість очікування вхідних запитів).
// doPost лишається виключно "надійною альтернативою google.script.run" для
// клієнта застосунку, як і було спочатку.
function doPost(e) {
  var response;
  try {
    var body = JSON.parse(e.postData.contents);
    var fn = API_WHITELIST_[body.fn];
    if (!fn) throw new Error('Невідома функція: ' + body.fn);
    var args = body.args || [];
    response = fn.apply(null, args);
  } catch (err) {
    response = fail_(err.message);
  }
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Генерація простого унікального ID.
 */
function newId_() {
  return Utilities.getUuid();
}

/**
 * Поточна дата/час у форматі рядка.
 */
function nowStr_() {
  return Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy-MM-dd HH:mm:ss');
}
