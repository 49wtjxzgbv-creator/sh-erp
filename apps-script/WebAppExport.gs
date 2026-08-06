/**
 * SH ERP v2 — SHСклад legacy-data export Web App.
 *
 * WHAT THIS IS: a single Apps Script file the SHСклад customer copies into
 * THEIR OWN legacy Google Sheet's Apps Script editor (Extensions > Apps
 * Script), then deploys as a Web App. SH ERP's import wizard
 * (Налаштування > Імпорт з SHСклад) then calls the deployed URL to pull a
 * full export as JSON. This script never runs inside SH ERP itself, and SH
 * ERP never gets any Google account access — it only ever sees the JSON
 * this script chooses to return, over plain HTTPS, gated by the TOKEN below.
 *
 * SETUP (for the customer, also shown in the wizard):
 *   1. Open your legacy SHСклад Google Sheet.
 *   2. Extensions > Apps Script.
 *   3. Delete any existing code in the editor, paste this whole file.
 *   4. Replace CHANGE_ME below with a long random string (this is your
 *      import token — anyone with the deployed URL AND this token can read
 *      your data, so keep it secret, e.g. a 32+ character random string).
 *   5. Deploy > New deployment > type: Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone
 *      (this does NOT make your spreadsheet public — it only allows this
 *      script's own doGet() to run when called, which itself checks TOKEN
 *      before returning anything)
 *   6. Copy the deployment URL (ends in /exec) and, together with your
 *      TOKEN, paste both into the SH ERP import wizard.
 *
 * CONTRACT: doGet(e) with ?action=data&token=... returns one JSON object
 * whose keys are the sheet names below (products, suppliers, warehouses,
 * warehouseStock, assemblies, assemblyComponents, assemblyVersions,
 * customerOrders, customerOrderItems, history), each an array of row
 * objects keyed by the sheet's own header row — i.e. exactly what
 * `sheet.getDataRange().getValues()` naturally gives you zipped with row 1,
 * with no re-typing or reformatting. This mirrors the row shape SH ERP's
 * own migration-toolkit already expects from a direct Sheets API read, so
 * the backend's transform logic is identical either way.
 *
 * ?action=photo&fileId=...&token=... returns { base64, mimeType } for one
 * Google Drive file — used by SH ERP's photo-migration pass, called once
 * per photo (not bundled into action=data) to stay well under Apps Script's
 * own ~6-minute execution / ~50MB response quotas for a single call.
 */

var TOKEN = 'CHANGE_ME';

// Sheet tab name -> key in the returned JSON. Must match the SH ERP backend's
// LegacyExportPayload keys (backend/src/modules/legacy-import/transform/index.ts)
// exactly, or the import wizard's dry-run will report missing keys.
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

function doGet(e) {
  var params = (e && e.parameter) || {};

  if (params.token !== TOKEN) {
    return jsonResponse({ error: 'Invalid or missing token.' });
  }

  try {
    if (params.action === 'data') {
      return jsonResponse(exportAllSheets());
    }
    if (params.action === 'photo') {
      if (!params.fileId) return jsonResponse({ error: 'Missing fileId parameter for action=photo.' });
      return jsonResponse(exportPhoto(params.fileId));
    }
    return jsonResponse({ error: 'Unknown action. Expected action=data or action=photo.' });
  } catch (err) {
    // Never let a raw stack trace leak to the caller — but do surface the
    // message, since the wizard's dry-run report is exactly where an
    // operator needs to see "sheet X not found" etc.
    return jsonResponse({ error: String(err && err.message ? err.message : err) });
  }
}

function exportAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = { meta: { exportedAt: new Date().toISOString(), deploymentId: ss.getId() } };

  for (var key in SHEETS) {
    var tabName = SHEETS[key];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      result[key] = []; // a sheet the customer's spreadsheet never had (e.g. no CustomerOrders tab at all) — empty, not an error, same "missing sheet = zero rows" tolerance migration-toolkit's own extract.ts already has.
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
      // cells — serialize to ISO 8601 so the JSON payload is unambiguous
      // (the backend's parseLegacyDate already accepts ISO strings). Every
      // other cell type (string/number/boolean) round-trips through
      // JSON.stringify as-is.
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
