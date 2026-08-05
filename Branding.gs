/**
 * Branding.gs — власні файли брендування (логотип, емблема), які admin може
 * завантажити сам через Налаштування, замість того, щоб покладатись на
 * згенерований логотип. Підставляються автоматично: емблема — у лівий
 * верхній кут усіх друкованих/PDF документів; логотип сайту — у верхню
 * панель застосунку та на екран входу.
 */

var BRANDING_KEYS_ = {
  site_logo: 'BrandSiteLogoUrl',   // логотип у верхній панелі й на вході
  print_logo: 'BrandPrintLogoUrl', // емблема в лівому верхньому куті друкованих документів
  favicon: 'BrandFaviconUrl'       // фавікон вкладки браузера
};

/**
 * Публічна (без обов'язкової автентифікації) — потрібна ще до входу, щоб
 * показати власний логотип на самому екрані входу.
 */
function getBrandingAssets(token) {
  try {
    var sheet = getDb_().getSheetByName(SHEET_SETTINGS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var values = {};
    for (var i = 1; i < data.length; i++) {
      values[data[i][idx.Key]] = data[i][idx.Value];
    }
    var result = {};
    Object.keys(BRANDING_KEYS_).forEach(function (assetType) {
      result[assetType] = values[BRANDING_KEYS_[assetType]] || '';
    });
    return ok_(result);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * assetType: 'site_logo' | 'print_logo' | 'favicon'
 */
function uploadBrandingAsset(token, assetType, base64Data, mimeType, fileName) {
  try {
    requireRole_(token, ['admin']);
    if (!BRANDING_KEYS_[assetType]) return fail_('Невідомий тип файлу брендування.');

    var folder = getPhotosFolder_();
    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType || 'image/svg+xml', fileName || (assetType + '.svg'));
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Для SVG/зображень беремо пряме посилання, придатне для <img src="">.
    var isSvg = (mimeType || '').indexOf('svg') !== -1;
    var url = isSvg
      ? 'https://drive.google.com/uc?export=view&id=' + file.getId()
      : 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';

    var sheet = getDb_().getSheetByName(SHEET_SETTINGS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var key = BRANDING_KEYS_[assetType];
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.Key] === key) {
        sheet.getRange(i + 1, idx.Value + 1).setValue(url);
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow([key, url]);

    return ok_({ url: url });
  } catch (e) {
    return fail_(e.message);
  }
}

function deleteBrandingAsset(token, assetType) {
  try {
    requireRole_(token, ['admin']);
    if (!BRANDING_KEYS_[assetType]) return fail_('Невідомий тип файлу брендування.');
    var key = BRANDING_KEYS_[assetType];
    var sheet = getDb_().getSheetByName(SHEET_SETTINGS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.Key] === key) {
        sheet.getRange(i + 1, idx.Value + 1).setValue('');
        break;
      }
    }
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}
