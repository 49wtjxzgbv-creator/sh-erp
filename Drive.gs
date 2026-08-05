/**
 * Drive.gs — завантаження, заміна та видалення фото товарів у Google Drive.
 * Клієнт передає фото як base64 (dataUrl), сервер зберігає Blob у папці.
 */

/**
 * Завантажити фото. base64Data — рядок без префікса "data:image/...;base64,".
 * Повертає публічне посилання для показу в <img>.
 */
function uploadProductPhoto(token, productId, base64Data, mimeType, fileName) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    var folder = getPhotosFolder_();

    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', fileName || (productId + '.jpg'));

    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';

    var found = findProductRow_(productId);
    if (found) {
      found.sheet.getRange(found.rowNum, found.idx.PhotoUrl + 1).setValue(url);
      found.sheet.getRange(found.rowNum, found.idx.UpdatedAt + 1).setValue(nowStr_());
    }

    return ok_({ url: url, fileId: file.getId() });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Видалити фото товару (переміщує файл у кошик Drive та очищає поле PhotoUrl).
 */
function deleteProductPhoto(token, productId) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    var found = findProductRow_(productId);
    if (!found) return fail_('Товар не знайдено.');

    var url = found.row[found.idx.PhotoUrl];
    var fileId = extractDriveFileId_(url);
    if (fileId) {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
    }

    found.sheet.getRange(found.rowNum, found.idx.PhotoUrl + 1).setValue('');
    found.sheet.getRange(found.rowNum, found.idx.UpdatedAt + 1).setValue(nowStr_());
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

function extractDriveFileId_(url) {
  if (!url) return null;
  var match = String(url).match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

/**
 * Фото виробу (складеного продукту) — окремо від фото компонентів,
 * щоб орієнтуватись по виробу візуально, а не тільки за назвою.
 */
/**
 * Креслення/PDF/фото виробу — окремо від звичайного фото товару. Якщо це
 * зображення, зберігаємо URL, який можна вставити прямо в друк (<img>);
 * якщо PDF чи інший файл — звичайне посилання на перегляд у Google Диску.
 */
function uploadAssemblyDrawing(token, assemblyId, base64Data, mimeType, fileName) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    var folder = getPhotosFolder_();

    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType || 'application/pdf', fileName || (assemblyId + '_drawing'));
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Google Диск сам генерує прев'ю-зображення першої сторінки і для PDF
    // (той самий механізм, яким Диск показує попередній перегляд файлів у
    // своєму інтерфейсі) — тому використовуємо той самий підхід, що й для
    // фото: це дає надійно вбудовуване й придатне для друку зображення
    // навіть для PDF-креслень, без потреби в окремій конвертації.
    // Оригінал (повний PDF, усі сторінки) лишається доступним окремим
    // посиланням — мініатюра лише для друку/перегляду першої сторінки.
    var isImage = (mimeType || '').indexOf('image/') === 0 || mimeType === 'application/pdf';
    var thumbnailUrl = isImage
      ? 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1500'
      : file.getUrl();
    var originalUrl = file.getUrl();

    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_ASSEMBLIES);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === assemblyId) {
        sheet.getRange(i + 1, idx.DrawingFileUrl + 1).setValue(thumbnailUrl);
        sheet.getRange(i + 1, idx.DrawingFileName + 1).setValue(fileName || '');
        sheet.getRange(i + 1, idx.DrawingMimeType + 1).setValue(mimeType || '');
        sheet.getRange(i + 1, idx.DrawingOriginalUrl + 1).setValue(originalUrl);
        sheet.getRange(i + 1, idx.UpdatedAt + 1).setValue(nowStr_());
        break;
      }
    }

    return ok_({ url: thumbnailUrl, originalUrl: originalUrl, isImage: isImage });
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteAssemblyDrawing(token, assemblyId) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    var sheet = getDb_().getSheetByName(SHEET_ASSEMBLIES);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === assemblyId) {
        sheet.getRange(i + 1, idx.DrawingFileUrl + 1).setValue('');
        sheet.getRange(i + 1, idx.DrawingFileName + 1).setValue('');
        sheet.getRange(i + 1, idx.DrawingMimeType + 1).setValue('');
        sheet.getRange(i + 1, idx.DrawingOriginalUrl + 1).setValue('');
        return ok_(true);
      }
    }
    return fail_('Виріб не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}

function uploadAssemblyPhoto(token, assemblyId, base64Data, mimeType, fileName) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    var folder = getPhotosFolder_();

    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', fileName || (assemblyId + '.jpg'));
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';

    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_ASSEMBLIES);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === assemblyId) {
        sheet.getRange(i + 1, idx.PhotoUrl + 1).setValue(url);
        sheet.getRange(i + 1, idx.UpdatedAt + 1).setValue(nowStr_());
        break;
      }
    }

    return ok_({ url: url });
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteAssemblyPhoto(token, assemblyId) {
  try {
    requireRole_(token, ['admin', 'storekeeper']);
    var ss = getDb_();
    var sheet = ss.getSheetByName(SHEET_ASSEMBLIES);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === assemblyId) {
        var fileId = extractDriveFileId_(data[i][idx.PhotoUrl]);
        if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {} }
        sheet.getRange(i + 1, idx.PhotoUrl + 1).setValue('');
        sheet.getRange(i + 1, idx.UpdatedAt + 1).setValue(nowStr_());
        return ok_(true);
      }
    }
    return fail_('Виріб не знайдено.');
  } catch (e) {
    return fail_(e.message);
  }
}
