/**
 * SH ERP Import Connector — universal Google Sheets/Apps Script data
 * connector for SH ERP (https://sh-erp.pro). Works for any spreadsheet
 * that follows the documented sheet/column contract below — not tied to
 * any specific legacy system.
 *
 * WHAT THIS IS: a single Apps Script file YOU paste into YOUR OWN Google
 * Sheet's Apps Script project (Extensions > Apps Script), then deploy as a
 * Web App. SH ERP's import wizard (Налаштування > Імпорт) then connects to
 * it. This script never runs inside SH ERP itself, and SH ERP never gets
 * any Google account access of its own — it only ever sees the JSON this
 * script chooses to return, over plain HTTPS.
 *
 * NO CODE EDITING REQUIRED, EVER — not even once. There is no TOKEN
 * constant or any other value to fill in here. Authentication is a
 * device-pairing handshake instead: SH ERP shows you a short pairing code,
 * you paste it into a menu inside THIS spreadsheet (Menu: "SH ERP" >
 * "Підключити"), and this script exchanges it for a real connection token
 * automatically, storing it in the script's own private storage
 * (PropertiesService) — you never see or type that token yourself.
 *
 * SETUP:
 *   1. Open your Google Sheet.
 *   2. Extensions > Apps Script.
 *   3. Delete any existing code in the editor, paste this whole file.
 *   4. Deploy > New deployment > type: Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone
 *      (Google will ask you to review/approve Sheets + Drive permissions —
 *      this is a normal one-time Google consent step, not something SH ERP
 *      controls.)
 *   5. Copy the deployment URL (ends in /exec).
 *   6. In SH ERP: Налаштування > Імпорт > "+ Додати джерело" > Google Apps
 *      Script. SH ERP shows a pairing code.
 *   7. Back in this spreadsheet, reload the page. A new "SH ERP" menu
 *      appears. Click "SH ERP" > "Підключити", paste the code, click OK.
 *   8. Done — SH ERP shows "З'єднано". Reconnecting later (if you click
 *      "Перепідключити" in SH ERP) never requires repeating steps 1-5,
 *      just step 7 again with a new code.
 *
 * DATA CONTRACT: doGet(e) with ?action=data&token=... returns one JSON
 * object whose keys are the sheet names below (products, suppliers,
 * warehouses, warehouseStock, assemblies, assemblyComponents,
 * assemblyVersions, customerOrders, customerOrderItems, history), each an
 * array of row objects keyed by the sheet's own header row — exactly what
 * `sheet.getDataRange().getValues()` naturally gives you zipped with row 1,
 * no re-typing or reformatting needed on your end. If your spreadsheet
 * doesn't have one of these tabs, that entity is simply empty in the
 * export — not an error.
 */

var PROTOCOL_VERSION = '1.0'; // bumped on any breaking change to this contract — not a secret, just a compatibility marker
var CONNECTOR_VERSION = '1.0.0'; // this file's own version, self-reported for diagnostics

var SH_ERP_API_BASE = 'https://sh-erp.pro/api/v1';
var TOKEN_PROPERTY_KEY = 'SH_ERP_CONNECTION_TOKEN';

// Sheet tab name -> key in the returned JSON. Must match the SH ERP backend's
// LegacyExportPayload keys exactly, or the import wizard's dry-run will
// report missing keys.
var SHEETS = {
  products: 'Products',
  suppliers: 'Suppliers',
  warehouses: 'Warehouses',
  warehouseStock: 'WarehouseStock',
  assemblies: 'Assemblies',
  assemblyComponents: 'AssemblyComponents',
  assemblyVersions: 'AssemblyVersions',
  customerOrders: 'CustomerOrders',
  customerOrderItems: 'CustomerOrderItems',
  history: 'History',
};

// ============================================================================
// Menu + pairing (runs inside the spreadsheet UI, never as part of doGet)
// ============================================================================

function onOpen() {
  // SpreadsheetApp.getUi() only works when this fires as a real trigger
  // (the spreadsheet actually being opened in the browser) — it throws
  // "Cannot call SpreadsheetApp.getUi() from this context" if someone runs
  // onOpen manually from the Apps Script editor's own Run button (no UI
  // context there). That's a normal, harmless thing for anyone testing the
  // script to try, so this no-ops instead of showing a scary error.
  try {
    SpreadsheetApp.getUi()
      .createMenu('SH ERP')
      .addItem('Підключити', 'showConnectPrompt')
      .addItem('Статус підключення', 'showConnectionStatus')
      .addToUi();
  } catch (e) {
    // No UI context (e.g. run manually from the editor) — nothing to do.
  }
}

function showConnectPrompt() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt('SH ERP — підключення', 'Введіть код підключення із SH ERP:', ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;

  var code = (result.getResponseText() || '').trim();
  if (!code) {
    ui.alert('Код не введено.');
    return;
  }

  try {
    var token = completePairing(code);
    PropertiesService.getScriptProperties().setProperty(TOKEN_PROPERTY_KEY, token);
    ui.alert('Підключено ✓', 'Це вікно можна закрити — поверніться в SH ERP.', ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Не вдалося підключитись: ' + err.message);
  }
}

function showConnectionStatus() {
  var ui = SpreadsheetApp.getUi();
  var token = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY_KEY);
  ui.alert(token ? 'Підключено ✓' : 'Не підключено — виберіть "SH ERP" > "Підключити".');
}

/** POSTs the pairing code + this deployment's own URL to SH ERP; SH ERP mints a real connection token in response. The user never sees or types that token — it's stored automatically. */
function completePairing(pairingCode) {
  var response = UrlFetchApp.fetch(SH_ERP_API_BASE + '/legacy-import/connections/pair', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      pairingCode: pairingCode,
      webAppUrl: ScriptApp.getService().getUrl(),
      protocolVersion: PROTOCOL_VERSION,
      connectorVersion: CONNECTOR_VERSION,
    }),
  });

  var body = JSON.parse(response.getContentText());
  if (response.getResponseCode() >= 300 || !body.ok) {
    throw new Error((body && (body.message || body.error)) || 'SH ERP відхилив код підключення.');
  }
  return body.connectionToken;
}

// ============================================================================
// Web App entry point — called BY SH ERP, not by the user
// ============================================================================

function doGet(e) {
  var params = (e && e.parameter) || {};
  var storedToken = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY_KEY);

  if (!storedToken || params.token !== storedToken) {
    return jsonResponse({ error: 'Not paired, or invalid token. Reconnect from SH ERP.' });
  }

  try {
    if (params.action === 'data') return jsonResponse(exportAllSheets());
    if (params.action === 'health') return jsonResponse(healthCheck());
    if (params.action === 'photo') {
      if (!params.fileId) return jsonResponse({ error: 'Missing fileId parameter for action=photo.' });
      return jsonResponse(exportPhoto(params.fileId));
    }
    if (params.action === 'revoke') {
      PropertiesService.getScriptProperties().deleteProperty(TOKEN_PROPERTY_KEY);
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: 'Unknown action. Expected action=data, action=health, action=photo, or action=revoke.' });
  } catch (err) {
    // Never let a raw stack trace leak to the caller — but do surface the
    // message, since SH ERP's dry-run report is exactly where this needs
    // to be visible.
    return jsonResponse({ error: String(err && err.message ? err.message : err) });
  }
}

function healthCheck() {
  var spreadsheetAccessible = false;
  var driveAccessible = false;
  try {
    SpreadsheetApp.getActiveSpreadsheet().getName();
    spreadsheetAccessible = true;
  } catch (e) {}
  try {
    DriveApp.getRootFolder().getId();
    driveAccessible = true;
  } catch (e) {}

  return {
    protocolVersion: PROTOCOL_VERSION,
    connectorVersion: CONNECTOR_VERSION,
    capabilities: ['data', 'photos', 'revoke'],
    spreadsheetAccessible: spreadsheetAccessible,
    driveAccessible: driveAccessible,
  };
}

function exportAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = {
    protocolVersion: PROTOCOL_VERSION,
    connectorVersion: CONNECTOR_VERSION,
    meta: { exportedAt: new Date().toISOString(), spreadsheetId: ss.getId() },
  };

  for (var key in SHEETS) {
    var tabName = SHEETS[key];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      result[key] = []; // a sheet this spreadsheet doesn't have (e.g. no CustomerOrders tab at all) — empty, not an error
      continue;
    }
    result[key] = sheetToRows(sheet);
  }

  return result;
}

function sheetToRows(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return []; // header row only, or empty sheet

  var headers = values[0];
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    // Skip fully-blank rows (a common trailing-rows artifact in hand-edited sheets) rather than exporting a row of empty strings.
    var isBlank = row.every(function (cell) { return cell === '' || cell === null; });
    if (isBlank) continue;

    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var header = headers[c];
      if (!header) continue; // blank header cell — column has no name, nothing sensible to key it by
      var cell = row[c];
      // Dates: Apps Script hands back real JS Date objects for date-formatted
      // cells — serialize to ISO 8601 so the JSON payload is unambiguous.
      obj[header] = cell instanceof Date ? cell.toISOString() : cell;
    }
    rows.push(obj);
  }
  return rows;
}

function exportPhoto(fileId) {
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  return {
    base64: Utilities.base64Encode(blob.getBytes()),
    mimeType: blob.getContentType(),
  };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
