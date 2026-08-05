/**
 * Assemblies.gs — «Вироби»: комплектація виробу з товарів складу.
 *
 * Кожен виріб (Assembly) має список компонентів (AssemblyComponents) —
 * посилання на товар зі складу та кількість, потрібну на 1 одиницю виробу.
 * Собівартість виробу рахується автоматично за двома цінами постачальників.
 * Кнопка "Дати в роботу" списує потрібну кількість компонентів зі складу
 * (як звичайна видача) і логує це в History.
 */

function listAssemblies(token) {
  try {
    var user = requireAuth_(token);
    var ss = getDb_();
    var asmSheet = ss.getSheetByName(SHEET_ASSEMBLIES);
    var compSheet = ss.getSheetByName(SHEET_ASSEMBLY_COMPONENTS);

    var asmData = asmSheet.getDataRange().getValues();
    var asmIdx = indexMap_(asmData[0]);
    var compData = compSheet.getDataRange().getValues();
    var compIdx = indexMap_(compData[0]);

    var componentCounts = {};
    for (var i = 1; i < compData.length; i++) {
      var aId = compData[i][compIdx.AssemblyID];
      if (!aId) continue;
      componentCounts[aId] = (componentCounts[aId] || 0) + 1;
    }
    var fgAvailability = getFinishedGoodsAvailability_();

    var list = [];
    for (var j = 1; j < asmData.length; j++) {
      var row = asmData[j];
      if (!row[asmIdx.ID]) continue;
      var listItem = {
        id: row[asmIdx.ID],
        name: row[asmIdx.Name],
        article: row[asmIdx.Article] || '',
        photoUrl: row[asmIdx.PhotoUrl],
        note: row[asmIdx.Note],
        componentCount: componentCounts[row[asmIdx.ID]] || 0,
        availableInStock: (fgAvailability[row[asmIdx.ID]] || { count: 0 }).count,
        updatedAt: row[asmIdx.UpdatedAt]
      };
      if (user.role === 'admin') {
        var avail = fgAvailability[row[asmIdx.ID]] || { avgUnitCostLocal: 0, avgUnitCostGerman: 0 };
        listItem.avgUnitCostLocal = avail.avgUnitCostLocal || 0;
        listItem.avgUnitCostGerman = avail.avgUnitCostGerman || 0;
        // Собівартість для картки: реальна (якщо вже виготовляли) або оцінка
        // за поточним рецептом (та сама логіка, що й у картці виробу), плюс
        // власні додаткові витрати виробу (праця/пакування/доставка/інше) —
        // лише в місцеву суму, німецька їх свідомо не враховує (див. calcAssemblyCost_).
        var recipeComponents = getAssemblyComponents_(row[asmIdx.ID], fgAvailability);
        var recipeCost = calcAssemblyCost_(recipeComponents, null, fgAvailability);
        var ownExtraCost = numOrZero_(row[asmIdx.LaborCostPerUnit]) + numOrZero_(row[asmIdx.PackagingCostPerUnit]) +
          numOrZero_(row[asmIdx.DeliveryCostPerUnit]) + numOrZero_(row[asmIdx.OtherCostPerUnit]);
        listItem.costLocal = round2_(recipeCost.local + ownExtraCost);
        listItem.costGerman = recipeCost.german;
      }
      list.push(listItem);
    }
    return ok_(list);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Повна картка виробу: компоненти з поточними цінами/залишками зі складу
 * та розрахованою собівартістю (лише для admin).
 */
/**
 * Перевірка комплектності НАПЕРЕД, без створення замовлення — "а якщо я
 * захочу зробити N штук цього виробу, чого не вистачить?" Використовується
 * і на сторінці виробу (щоб бачити це одразу), і перед створенням
 * виробничих замовлень із замовлення клієнта.
 */
function checkAssemblyAvailability(token, assemblyId, unitsPlanned) {
  try {
    requireAuth_(token);
    unitsPlanned = Number(unitsPlanned) || 1;

    var components = getAssemblyComponents_(assemblyId);
    if (!components.length) return fail_('У виробі немає компонентів.');

    var reserved = getReservedQtyMap_();
    var reservedFg = getReservedFinishedGoodsMap_();
    var shortages = [];
    var ok = true;

    components.forEach(function (c) {
      var needed = c.qty * unitsPlanned;

      if (c.componentType === 'assembly') {
        var availableCount = (c.subAssembly ? c.subAssembly.availableInStock : 0) - (reservedFg[c.subAssemblyId] || 0);
        if (availableCount < needed) {
          ok = false;
          shortages.push({
            subAssemblyId: c.subAssemblyId, article: '', name: (c.subAssembly ? c.subAssembly.name : '(виріб видалено)') + ' (готовий виріб)',
            needed: needed, available: Math.max(0, availableCount), shortage: round2_(needed - availableCount)
          });
        }
        return;
      }

      if (!c.product) { shortages.push({ article: '', name: '(товар видалено зі складу)', needed: needed, available: 0, shortage: needed }); ok = false; return; }
      var alreadyReserved = reserved[c.productId] || 0;
      var available = c.product.qty - alreadyReserved;
      if (available < needed) {
        ok = false;
        shortages.push({
          productId: c.productId, article: c.product.article, name: c.product.name,
          needed: needed, available: Math.max(0, available), shortage: round2_(needed - available)
        });
      }
    });

    return ok_({ enough: ok, unitsPlanned: unitsPlanned, shortages: shortages });
  } catch (e) {
    return fail_(e.message);
  }
}

function getAssembly(token, assemblyId) {
  try {
    var user = requireAuth_(token);
    var ss = getDb_();
    var asmSheet = ss.getSheetByName(SHEET_ASSEMBLIES);
    var asmData = asmSheet.getDataRange().getValues();
    var asmIdx = indexMap_(asmData[0]);

    var asmRow = null;
    for (var i = 1; i < asmData.length; i++) {
      if (asmData[i][asmIdx.ID] === assemblyId) { asmRow = asmData[i]; break; }
    }
    if (!asmRow) return fail_('Виріб не знайдено.');

    var components = getAssemblyComponents_(assemblyId);

    var result = {
      id: asmRow[asmIdx.ID],
      name: asmRow[asmIdx.Name],
      article: asmRow[asmIdx.Article] || '',
      note: asmRow[asmIdx.Note],
      photoUrl: asmRow[asmIdx.PhotoUrl],
      drawingFileUrl: asmRow[asmIdx.DrawingFileUrl] || '',
      drawingFileName: asmRow[asmIdx.DrawingFileName] || '',
      drawingMimeType: asmRow[asmIdx.DrawingMimeType] || '',
      drawingOriginalUrl: asmRow[asmIdx.DrawingOriginalUrl] || '',
      defaultSupplierId: asmRow[asmIdx.DefaultSupplierId] || '',
      laborCostPerUnit: numOrZero_(asmRow[asmIdx.LaborCostPerUnit]),
      packagingCostPerUnit: numOrZero_(asmRow[asmIdx.PackagingCostPerUnit]),
      deliveryCostPerUnit: numOrZero_(asmRow[asmIdx.DeliveryCostPerUnit]),
      otherCostPerUnit: numOrZero_(asmRow[asmIdx.OtherCostPerUnit]),
      components: components.map(function (c) {
        if (c.componentType === 'assembly') {
          var subItem = {
            componentType: 'assembly',
            subAssemblyId: c.subAssemblyId,
            name: c.subAssembly ? c.subAssembly.name : '(виріб видалено)',
            article: c.subAssembly ? (c.subAssembly.article || '') : '',
            photoUrl: c.subAssembly ? c.subAssembly.photoUrl : '',
            qtyPerUnit: c.qty,
            availableInStock: c.subAssembly ? c.subAssembly.availableInStock : 0
          };
          if (user.role === 'admin' && c.subAssembly) {
            if (c.subAssembly.availableInStock > 0) {
              // Уже реально виготовляли — беремо ЧЕСНУ фактичну середню собівартість.
              subItem.unitCostLocal = c.subAssembly.unitCostLocal || 0;
              subItem.unitCostGerman = c.subAssembly.unitCostGerman || 0;
            } else {
              // Жодного разу не виготовляли — інакше unitCostLocal завжди був би 0,
              // і ціна цього вкладеного виробу зникала б і в картці, і в друку
              // специфікації з цінами. Рахуємо ОЦІНКУ за поточним рецептом
              // (рекурсивно) — так само, як живий попередній перегляд у формі.
              var subEstimate = calcAssemblyCost_(getAssemblyComponents_(c.subAssemblyId));
              subItem.unitCostLocal = round2_(subEstimate.local + getAssemblyOwnExtraCostLocal_(c.subAssemblyId));
              subItem.unitCostGerman = subEstimate.german;
            }
          }
          return subItem;
        }
        var item = {
          componentType: 'product',
          productId: c.productId,
          article: c.product ? c.product.article : '(товар видалено)',
          name: c.product ? c.product.name : '',
          unit: c.product ? c.product.unit : '',
          photoUrl: c.product ? c.product.photoUrl : '',
          qtyPerUnit: c.qty,
          warehouseId: c.warehouseId || '',
          availableQty: c.product ? c.product.qty : 0
        };
        if (user.role === 'admin' && c.product) {
          item.sellPriceEur = c.product.sellPriceEur;
          item.germanPriceExclVat = c.product.germanPriceExclVat;
        }
        return item;
      })
    };

    if (user.role === 'admin') {
      var totals = calcAssemblyCost_(components);
      // Додаткові витрати (праця/пакування/доставка/інше) входять в оцінку
      // собівартості одразу, ще до фактичного запуску у виробництво —
      // тільки в місцеву суму, німецька їх не враховує (навмисно).
      var ownExtraCostTop = result.laborCostPerUnit + result.packagingCostPerUnit + result.deliveryCostPerUnit + result.otherCostPerUnit;
      result.totalLocalCostEur = round2_(totals.local + ownExtraCostTop);
      result.totalGermanCostEur = totals.german;
    }

    return ok_(result);
  } catch (e) {
    return fail_(e.message);
  }
}

function getAssemblyComponents_(assemblyId, precomputedFgAvailability) {
  var ss = getDb_();
  var compSheet = ss.getSheetByName(SHEET_ASSEMBLY_COMPONENTS);
  var compData = compSheet.getDataRange().getValues();
  var compIdx = indexMap_(compData[0]);

  var productsSheet = ss.getSheetByName(SHEET_PRODUCTS);
  var productsData = productsSheet.getDataRange().getValues();
  var productsIdx = indexMap_(productsData[0]);
  var productsById = {};
  for (var p = 1; p < productsData.length; p++) {
    var pRow = productsData[p];
    if (pRow[productsIdx.ID]) productsById[pRow[productsIdx.ID]] = rowToProduct_(pRow, productsIdx);
  }

  var asmSheet = ss.getSheetByName(SHEET_ASSEMBLIES);
  var asmData = asmSheet.getDataRange().getValues();
  var asmIdx = indexMap_(asmData[0]);
  var assembliesById = {};
  for (var a = 1; a < asmData.length; a++) {
    if (asmData[a][asmIdx.ID]) assembliesById[asmData[a][asmIdx.ID]] = { name: asmData[a][asmIdx.Name], article: asmData[a][asmIdx.Article] || '', photoUrl: asmData[a][asmIdx.PhotoUrl], defaultSupplierId: asmData[a][asmIdx.DefaultSupplierId] || '' };
  }

  var fgAvailability = precomputedFgAvailability || getFinishedGoodsAvailability_(); // {assemblyId: {count, avgUnitCostLocal, avgUnitCostGerman}}

  var components = [];
  for (var i = 1; i < compData.length; i++) {
    var row = compData[i];
    if (row[compIdx.AssemblyID] !== assemblyId) continue;
    var componentType = row[compIdx.ComponentType] || 'product';

    if (componentType === 'assembly') {
      var subId = row[compIdx.SubAssemblyID];
      var sub = assembliesById[subId] || null;
      var avail = fgAvailability[subId] || { count: 0, avgUnitCostLocal: 0, avgUnitCostGerman: 0 };
      components.push({
        rowId: row[compIdx.ID],
        componentType: 'assembly',
        subAssemblyId: subId,
        qty: Number(row[compIdx.Qty]) || 0,
        warehouseId: '',
        subAssembly: sub ? { name: sub.name, article: sub.article || '', photoUrl: sub.photoUrl, availableInStock: avail.count, unitCostLocal: avail.avgUnitCostLocal || 0, unitCostGerman: avail.avgUnitCostGerman || 0, supplierIdForPurchase: sub.defaultSupplierId || '', supplierNameForPurchase: '' } : null,
        product: null
      });
    } else {
      components.push({
        rowId: row[compIdx.ID],
        componentType: 'product',
        productId: row[compIdx.ProductID],
        qty: Number(row[compIdx.Qty]) || 0,
        warehouseId: row[compIdx.WarehouseID] || '',
        product: productsById[row[compIdx.ProductID]] || null
      });
    }
  }
  return components;
}

/**
 * Наявність готових виробів на складі (для компонентів-виробів) — кількість
 * "на складі" (in_stock) по кожному виробу, і середня фактична собівартість
 * одиниці (з тих, що реально виготовлені) — для точного розрахунку
 * собівартості вищого виробу.
 */
function getFinishedGoodsAvailability_() {
  var sheet = getDb_().getSheetByName(SHEET_FINISHED_GOODS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  var byAssembly = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[idx.Status] !== 'in_stock') continue;
    var asmId = row[idx.AssemblyID];
    if (!byAssembly[asmId]) byAssembly[asmId] = { count: 0, sumLocal: 0, sumGerman: 0 };
    byAssembly[asmId].count++;
    byAssembly[asmId].sumLocal += Number(row[idx.UnitCostLocalEur]) || 0;
    byAssembly[asmId].sumGerman += Number(row[idx.UnitCostGermanEur]) || 0;
  }
  var result = {};
  Object.keys(byAssembly).forEach(function (id) {
    var b = byAssembly[id];
    result[id] = { count: b.count, avgUnitCostLocal: b.count ? round2_(b.sumLocal / b.count) : 0, avgUnitCostGerman: b.count ? round2_(b.sumGerman / b.count) : 0 };
  });
  return result;
}

/**
 * Оцінка собівартості виробу за його ПОТОЧНИМ рецептом (рекурсивно) —
 * використовується живим попереднім переглядом у формі редагування, коли
 * компонент-виріб ще жодного разу не виготовлявся і фактичної собівартості
 * немає, з чого порахувати.
 */
function getAssemblyEstimatedCost(token, assemblyId) {
  try {
    requireAuth_(token);
    var components = getAssemblyComponents_(assemblyId);
    var cost = calcAssemblyCost_(components);
    var ownExtraCost = getAssemblyOwnExtraCostLocal_(assemblyId);
    return ok_({ local: round2_(cost.local + ownExtraCost), german: cost.german });
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Сума власних додаткових витрат на одиницю (праця + пакування + доставка +
 * інше), вказаних у картці ЦЬОГО виробу — тільки місцева сума (EUR).
 * Використовується для того, щоб оцінка собівартості (до фактичного
 * виробництва) враховувала ці витрати одразу, а не тільки заднім числом
 * після "Дати в роботу".
 */
function getAssemblyOwnExtraCostLocal_(assemblyId) {
  var asmSheet = getDb_().getSheetByName(SHEET_ASSEMBLIES);
  var asmData = asmSheet.getDataRange().getValues();
  var asmIdx = indexMap_(asmData[0]);
  for (var i = 1; i < asmData.length; i++) {
    if (asmData[i][asmIdx.ID] === assemblyId) {
      return numOrZero_(asmData[i][asmIdx.LaborCostPerUnit]) + numOrZero_(asmData[i][asmIdx.PackagingCostPerUnit]) +
        numOrZero_(asmData[i][asmIdx.DeliveryCostPerUnit]) + numOrZero_(asmData[i][asmIdx.OtherCostPerUnit]);
    }
  }
  return 0;
}

function calcAssemblyCost_(components, visitedAssemblyIds, precomputedFgAvailability) {
  var local = 0, german = 0;
  var fgAvailability = precomputedFgAvailability || null;
  components.forEach(function (c) {
    if (c.componentType === 'assembly') {
      if (!fgAvailability) fgAvailability = getFinishedGoodsAvailability_();
      var avail = fgAvailability[c.subAssemblyId];
      if (avail && avail.count > 0) {
        // Виріб уже реально виготовлявся — беремо ЧЕСНУ фактичну собівартість
        // тих одиниць, що на складі (пріоритет, бо це не оцінка, а факт).
        local += avail.avgUnitCostLocal * c.qty;
        german += avail.avgUnitCostGerman * c.qty;
        return;
      }
      // Ще жодного разу не виготовляли — рахуємо ОЦІНКУ за поточним рецептом
      // цього під-виробу (рекурсивно, аж до самих товарів). visitedAssemblyIds
      // захищає від зациклення, якщо десь у ланцюжку вироби посилаються один
      // на одного по колу.
      visitedAssemblyIds = visitedAssemblyIds || {};
      if (visitedAssemblyIds[c.subAssemblyId]) return; // цикл у специфікації — пропускаємо, а не зависаємо
      var nextVisited = Object.assign({}, visitedAssemblyIds);
      nextVisited[c.subAssemblyId] = true;
      var subComponents = getAssemblyComponents_(c.subAssemblyId, fgAvailability);
      var subCost = calcAssemblyCost_(subComponents, nextVisited, fgAvailability);
      var subOwnExtraCost = getAssemblyOwnExtraCostLocal_(c.subAssemblyId);
      local += (subCost.local + subOwnExtraCost) * c.qty;
      german += subCost.german * c.qty;
      return;
    }
    if (!c.product) return;
    local += (c.product.sellPriceEur || 0) * c.qty;
    german += (c.product.germanPriceExclVat || 0) * c.qty;
  });
  return { local: round2_(local), german: round2_(german) };
}

function round2_(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Безпечне читання грошових клітинок з аркуша "Assemblies".
 * Якщо клітинка чомусь відформатована в Google Таблиці як Дата/Час
 * (а не Число) — GAS поверне з getValues() об'єкт Date замість числа
 * (навіть для порожньої/нульової клітинки, бо "нульова" дата в Google
 * Таблицях — 30.12.1899). Звичайний Number(дата) тоді дає мілісекунди
 * від епохи — величезне від'ємне число. Ця функція про це знає й завжди
 * повертає 0 для об'єкта Date, замість сміттєвого числа.
 */
function numOrZero_(v) {
  if (v instanceof Date) return 0;
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Створити або повністю оновити виріб (назва, примітка, повний список компонентів).
 * payload = { name, note, components: [{ productId, qty }] }
 */
function saveAssembly(token, assemblyId, payload) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    if (!payload.name) return fail_('Вкажіть назву виробу.');
    if (!payload.components || !payload.components.length) return fail_('Додайте хоча б один компонент.');

    var ss = getDb_();
    var asmSheet = ss.getSheetByName(SHEET_ASSEMBLIES);
    var now = nowStr_();
    var id = assemblyId;

    if (id) {
      var asmData = asmSheet.getDataRange().getValues();
      var asmIdx = indexMap_(asmData[0]);
      var found = false;
      for (var i = 1; i < asmData.length; i++) {
        if (asmData[i][asmIdx.ID] === id) {
          asmSheet.getRange(i + 1, asmIdx.Name + 1).setValue(payload.name);
          asmSheet.getRange(i + 1, asmIdx.Article + 1).setValue(payload.article || '');
          asmSheet.getRange(i + 1, asmIdx.Note + 1).setValue(payload.note || '');
          asmSheet.getRange(i + 1, asmIdx.UpdatedAt + 1).setValue(now);
          // .setNumberFormat('0.00') тут ОБОВ'ЯЗКОВО — інакше клітинка може лишитись
          // (або знову стати) відформатованою як Дата/Час, і наступне читання поверне
          // сміттєве число замість суми (див. numOrZero_ вище).
          asmSheet.getRange(i + 1, asmIdx.LaborCostPerUnit + 1).setNumberFormat('0.00').setValue(Number(payload.laborCostPerUnit) || 0);
          asmSheet.getRange(i + 1, asmIdx.PackagingCostPerUnit + 1).setNumberFormat('0.00').setValue(Number(payload.packagingCostPerUnit) || 0);
          asmSheet.getRange(i + 1, asmIdx.DeliveryCostPerUnit + 1).setNumberFormat('0.00').setValue(Number(payload.deliveryCostPerUnit) || 0);
          asmSheet.getRange(i + 1, asmIdx.OtherCostPerUnit + 1).setNumberFormat('0.00').setValue(Number(payload.otherCostPerUnit) || 0);
          asmSheet.getRange(i + 1, asmIdx.DefaultSupplierId + 1).setValue(payload.defaultSupplierId || '');
          found = true;
          break;
        }
      }
      if (!found) return fail_('Виріб не знайдено.');
      clearAssemblyComponents_(id);
    } else {
      id = newId_();
      asmSheet.appendRow([id, payload.name, payload.article || '', payload.note || '', '', now, now,
        Number(payload.laborCostPerUnit) || 0, Number(payload.packagingCostPerUnit) || 0,
        Number(payload.deliveryCostPerUnit) || 0, Number(payload.otherCostPerUnit) || 0,
        '', '', '', '', payload.defaultSupplierId || '']);
      // Явно фіксуємо формат "Число" для щойно доданого рядка — щоб ці 4
      // клітинки ніколи не з'їхали у формат Дата/Час (див. numOrZero_ вище).
      var newRowNum = asmSheet.getLastRow();
      var newAsmIdx = indexMap_(asmSheet.getRange(1, 1, 1, asmSheet.getLastColumn()).getValues()[0]);
      [newAsmIdx.LaborCostPerUnit, newAsmIdx.PackagingCostPerUnit, newAsmIdx.DeliveryCostPerUnit, newAsmIdx.OtherCostPerUnit].forEach(function (col) {
        if (col != null) asmSheet.getRange(newRowNum, col + 1).setNumberFormat('0.00');
      });
    }

    var compSheet = ss.getSheetByName(SHEET_ASSEMBLY_COMPONENTS);
    payload.components.forEach(function (c) {
      if (c.componentType === 'assembly') {
        if (!c.subAssemblyId || !c.qty) return;
        if (c.subAssemblyId === id) return; // виріб не може складатись сам із себе
        compSheet.appendRow([newId_(), id, '', Number(c.qty), '', 'assembly', c.subAssemblyId]);
      } else {
        if (!c.productId || !c.qty) return;
        compSheet.appendRow([newId_(), id, c.productId, Number(c.qty), c.warehouseId || '', 'product', '']);
      }
    });

    // Знімок специфікації (BOM) — щоб зберегти повну історію змін і щоб
    // виробничі замовлення могли й надалі посилатись на ТУ версію, яка була
    // чинною на момент їхнього створення, навіть якщо рецепт зміниться пізніше.
    saveAssemblyVersionSnapshot_(id, payload.components, user);

    logHistory_(user, assemblyId ? 'Редагування виробу' : 'Створення виробу', '', payload.name, 0,
      payload.components.length + ' компонент(ів)');

    return ok_({ id: id });
  } catch (e) {
    return fail_(e.message);
  }
}

function saveAssemblyVersionSnapshot_(assemblyId, components, user) {
  var sheet = getDb_().getSheetByName(SHEET_ASSEMBLY_VERSIONS);
  var data = sheet.getDataRange().getValues();
  var maxVersion = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === assemblyId) maxVersion = Math.max(maxVersion, Number(data[i][2]) || 0);
  }
  var newVersion = maxVersion + 1;
  var snapshot = components
    .filter(function (c) { return c.componentType === 'assembly' ? (c.subAssemblyId && c.qty) : (c.productId && c.qty); })
    .map(function (c) {
      return c.componentType === 'assembly'
        ? { componentType: 'assembly', subAssemblyId: c.subAssemblyId, qty: Number(c.qty) }
        : { componentType: 'product', productId: c.productId, qty: Number(c.qty), warehouseId: c.warehouseId || '' };
    });
  sheet.appendRow([newId_(), assemblyId, newVersion, JSON.stringify(snapshot), nowStr_(), user.fullName || user.login]);
  return newVersion;
}

/**
 * Список версій специфікації виробу (найновіша перша) — для перегляду історії змін.
 */
function listAssemblyVersions(token, assemblyId) {
  try {
    requireAuth_(token);
    var sheet = getDb_().getSheetByName(SHEET_ASSEMBLY_VERSIONS);
    var data = sheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);

    var productsSheet = getDb_().getSheetByName(SHEET_PRODUCTS);
    var productsData = productsSheet.getDataRange().getValues();
    var productsIdx = indexMap_(productsData[0]);
    var productsById = {};
    for (var p = 1; p < productsData.length; p++) {
      if (productsData[p][productsIdx.ID]) productsById[productsData[p][productsIdx.ID]] = productsData[p];
    }

    var versions = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[idx.AssemblyID] !== assemblyId) continue;
      var components = [];
      try {
        components = JSON.parse(row[idx.ComponentsJson] || '[]').map(function (c) {
          var pRow = productsById[c.productId];
          return {
            article: pRow ? pRow[productsIdx.Article] : '(товар видалено)',
            name: pRow ? pRow[productsIdx.Name] : '',
            qty: c.qty
          };
        });
      } catch (e) {}
      versions.push({
        versionNumber: Number(row[idx.VersionNumber]) || 0,
        components: components,
        createdAt: row[idx.CreatedAt],
        createdBy: row[idx.CreatedBy]
      });
    }
    versions.sort(function (a, b) { return b.versionNumber - a.versionNumber; });
    return ok_(versions);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * Компоненти виробу за КОНКРЕТНОЮ версією специфікації (а не поточною) —
 * саме це використовує виробництво, щоб не "з'їжджати" на нову версію,
 * якщо рецепт зміниться вже ПІСЛЯ створення замовлення.
 */
function getAssemblyComponentsAtVersion_(assemblyId, versionNumber) {
  var sheet = getDb_().getSheetByName(SHEET_ASSEMBLY_VERSIONS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);

  var snapshot = null;
  for (var i = 1; i < data.length; i++) {
    if (data[i][idx.AssemblyID] === assemblyId && Number(data[i][idx.VersionNumber]) === Number(versionNumber)) {
      try { snapshot = JSON.parse(data[i][idx.ComponentsJson] || '[]'); } catch (e) { snapshot = []; }
      break;
    }
  }
  if (!snapshot) return getAssemblyComponents_(assemblyId); // немає знімка (старі дані до цієї фічі) — fallback на поточний склад

  var productsSheet = getDb_().getSheetByName(SHEET_PRODUCTS);
  var productsData = productsSheet.getDataRange().getValues();
  var productsIdx = indexMap_(productsData[0]);
  var productsById = {};
  for (var p = 1; p < productsData.length; p++) {
    if (productsData[p][productsIdx.ID]) productsById[productsData[p][productsIdx.ID]] = rowToProduct_(productsData[p], productsIdx);
  }

  var asmSheet = getDb_().getSheetByName(SHEET_ASSEMBLIES);
  var asmData = asmSheet.getDataRange().getValues();
  var asmIdx = indexMap_(asmData[0]);
  var assembliesById = {};
  for (var a = 1; a < asmData.length; a++) {
    if (asmData[a][asmIdx.ID]) assembliesById[asmData[a][asmIdx.ID]] = { name: asmData[a][asmIdx.Name], article: asmData[a][asmIdx.Article] || '', photoUrl: asmData[a][asmIdx.PhotoUrl], defaultSupplierId: asmData[a][asmIdx.DefaultSupplierId] || '' };
  }
  var fgAvailability = getFinishedGoodsAvailability_();

  return snapshot.map(function (c) {
    if (c.componentType === 'assembly') {
      var sub = assembliesById[c.subAssemblyId] || null;
      var avail = fgAvailability[c.subAssemblyId] || { count: 0 };
      return {
        componentType: 'assembly', subAssemblyId: c.subAssemblyId, qty: Number(c.qty) || 0,
        subAssembly: sub ? { name: sub.name, article: sub.article || '', photoUrl: sub.photoUrl, availableInStock: avail.count, unitCostLocal: avail.avgUnitCostLocal || 0, unitCostGerman: avail.avgUnitCostGerman || 0, supplierIdForPurchase: sub.defaultSupplierId || '', supplierNameForPurchase: '' } : null,
        product: null
      };
    }
    return { componentType: 'product', productId: c.productId, qty: Number(c.qty) || 0, warehouseId: c.warehouseId || '', product: productsById[c.productId] || null };
  });
}

function getLatestAssemblyVersionNumber_(assemblyId) {
  var sheet = getDb_().getSheetByName(SHEET_ASSEMBLY_VERSIONS);
  var data = sheet.getDataRange().getValues();
  var max = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === assemblyId) max = Math.max(max, Number(data[i][2]) || 0);
  }
  return max;
}

function clearAssemblyComponents_(assemblyId) {
  var sheet = getDb_().getSheetByName(SHEET_ASSEMBLY_COMPONENTS);
  var data = sheet.getDataRange().getValues();
  var idx = indexMap_(data[0]);
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][idx.AssemblyID] === assemblyId) sheet.deleteRow(i + 1);
  }
}

function deleteAssembly(token, assemblyId) {
  try {
    var user = requireRole_(token, ['admin']);
    var ss = getDb_();
    var asmSheet = ss.getSheetByName(SHEET_ASSEMBLIES);
    var data = asmSheet.getDataRange().getValues();
    var idx = indexMap_(data[0]);
    var rowNum = null, name = '';
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx.ID] === assemblyId) { rowNum = i + 1; name = data[i][idx.Name]; break; }
    }
    if (!rowNum) return fail_('Виріб не знайдено.');

    clearAssemblyComponents_(assemblyId);
    asmSheet.deleteRow(rowNum);
    logHistory_(user, 'Видалення виробу', '', name, 0, '');
    return ok_(true);
  } catch (e) {
    return fail_(e.message);
  }
}

/**
 * "Дати в роботу": списує зі складу всі компоненти виробу, помножені на кількість
 * виробів, яку потрібно зібрати. Виконується лише якщо ВСІХ компонентів вистачає —
 * інакше жодна позиція не списується (все або нічого).
 */
function produceAssembly(token, assemblyId, unitsToProduce, comment) {
  try {
    var user = requireRole_(token, ['admin', 'storekeeper']);
    unitsToProduce = Number(unitsToProduce) || 0;
    if (unitsToProduce <= 0) return fail_('Вкажіть кількість виробів для запуску в роботу.');

    var ss = getDb_();
    var asmSheet = ss.getSheetByName(SHEET_ASSEMBLIES);
    var asmData = asmSheet.getDataRange().getValues();
    var asmIdx = indexMap_(asmData[0]);
    var assemblyName = '';
    for (var i = 1; i < asmData.length; i++) {
      if (asmData[i][asmIdx.ID] === assemblyId) { assemblyName = asmData[i][asmIdx.Name]; break; }
    }
    if (!assemblyName) return fail_('Виріб не знайдено.');

    var components = getAssemblyComponents_(assemblyId);
    if (!components.length) return fail_('У виробі немає компонентів.');

    // Перевірка достатності залишків ПЕРЕД списанням (усе або нічого).
    var shortages = [];
    components.forEach(function (c) {
      if (!c.product) { shortages.push('Товар видалено зі складу (ID: ' + c.productId + ')'); return; }
      var needed = c.qty * unitsToProduce;
      if (c.product.qty < needed) {
        shortages.push(c.product.name + ': потрібно ' + needed + ', наявно ' + c.product.qty);
      }
    });
    if (shortages.length) return fail_('Недостатньо залишків: ' + shortages.join('; '));

    var totals = calcAssemblyCost_(components);
    var totalLocal = round2_(totals.local * unitsToProduce);
    var totalGerman = round2_(totals.german * unitsToProduce);
    var pickList = []; // для друкованого аркуша видачі зі складу

    // Списання кожного компонента зі складу.
    components.forEach(function (c) {
      var found = findProductRow_(c.productId);
      if (!found) return;
      var needed = c.qty * unitsToProduce;
      var newQty = Number(found.row[found.idx.Qty]) - needed;
      found.sheet.getRange(found.rowNum, found.idx.Qty + 1).setValue(newQty);
      found.sheet.getRange(found.rowNum, found.idx.UpdatedAt + 1).setValue(nowStr_());

      logHistory_(user, 'Списання на виріб', found.row[found.idx.Article], found.row[found.idx.Name], -needed,
        'Виріб: ' + assemblyName + ' × ' + unitsToProduce + (comment ? ' — ' + comment : ''));

      pickList.push({
        article: found.row[found.idx.Article],
        code: found.row[found.idx.Code],
        name: found.row[found.idx.Name],
        cell: found.row[found.idx.Cell],
        unit: found.row[found.idx.Unit],
        qty: needed
      });
    });

    logHistory_(user, 'Запуск виробу в роботу', '', assemblyName, unitsToProduce,
      'Собівартість: ' + totalLocal + ' EUR (місцевий) / ' + totalGerman + ' EUR (Німеччина)' + (comment ? ' — ' + comment : ''));

    var response = {
      unitsProduced: unitsToProduce,
      assemblyName: assemblyName,
      pickList: pickList
    };
    if (user.role === 'admin') {
      response.totalLocalCostEur = totalLocal;
      response.totalGermanCostEur = totalGerman;
    }
    return ok_(response);
  } catch (e) {
    return fail_(e.message);
  }
}
