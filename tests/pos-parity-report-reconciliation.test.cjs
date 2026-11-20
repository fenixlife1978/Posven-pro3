const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const sales = read('src/components/modules/SalesModule.tsx');
const store = read('src/lib/sqlite/pos-store.ts');
const dbStore = read('src/lib/db-store.ts');
const cashModal = read('src/components/pos/CashZArqueoModal.tsx');
const zPreview = read('src/components/pos/ZReportPreview80mm.tsx');
const receipt = read('src/components/pos/ReceiptModal.tsx');

test('X/Z incluye operaciones de la apertura y carga anulaciones del período', () => {
  assert.match(dbStore, /return itemMs >= cutoffMs/);
  assert.match(dbStore, /loadReportWindow\('anulaciones', termId, desde\)/);
  assert.match(dbStore, /ensureLoaded\('anulaciones'\)/);
  assert.match(sales, /return dateMs >= cutoffMs/);
  assert.match(store, /return dateMs >= cutoffMs/);
});

test('el arqueo no inventa salidas por devoluciones o anulaciones sin asiento de reintegro', () => {
  assert.match(store, /const applyRefund = \(doc: any, kind: 'devolucion' \| 'anulacion'\)/);
  assert.match(store, /if \(!evidence\) return/);
  assert.match(store, /String\(entry\.referencia \|\| ''\) === String\(doc\.id\)/);
  assert.doesNotMatch(store, /voidedSales\.filter\([\s\S]{0,220}?row\.devUSD/);
  assert.match(store, /const excludedJournalCategories = new Set\(\['VENTA','COBRO_DEUDA','DEVOLUCION','ANULACION'\]\)/);
});

test('el cierre Z rechaza pagos mixtos sin desglose y no trata vale interno como efectivo', () => {
  assert.match(sales, /arqueoWarnings = allVentas/);
  assert.match(sales, /normalizarMetodo\(sale\.metodoPago\) === 'mixto'/);
  assert.match(store, /const arqueoWarnings = allSales/);
  assert.match(store, /if \(arqueoWarnings\.length\) throw new Error/);
  assert.match(store, /const systemAmount = method === 'nota_credito' \? 0/);
  assert.match(cashModal, /"nota_credito"/);
  assert.match(cashModal, /method === "nota_credito" \? 0/);
  assert.match(cashModal, /hasUnresolvedPayments/);
  assert.match(cashModal, /missingRequired = rows\.filter\(\(row\) => String\(real\[row\.method\] \?\? ""\)\.trim\(\) === ""\)/);
});

test('el comprobante identifica conciliación, faltante, sobrante o ausencia de arqueo real', () => {
  assert.match(zPreview, /ARQUEO REAL NO REGISTRADO/);
  assert.match(zPreview, /ARQUEO CONCILIADO/);
  assert.match(zPreview, /CIERRE CON FALTANTE/);
  assert.match(zPreview, /CIERRE CON SOBRANTE/);
  assert.match(receipt, /ARQUEO REAL NO REGISTRADO/);
});

test('Corte X ofrece conteo temporal sin persistir ni cerrar la caja', () => {
  assert.match(cashModal, /mode: 'X' \| 'Z'/);
  assert.match(cashModal, /LECTURA X — SIN CONTEO REAL/);
  assert.match(cashModal, /El conteo X es opcional y temporal/);
  assert.match(cashModal, /mode === 'Z' && \(/);
  assert.match(sales, /setArqueoMode\(type === 'REPORT_Z' \? 'Z' : 'X'\)/);
});

test('los cobros CxC históricos del libro diario se incluyen una sola vez', () => {
  assert.match(store, /const uniqueDebtJournal = debtJournal\.filter/);
  assert.match(store, /reference\.includes\(String\(sale\.id\)\)/);
  assert.match(store, /uniqueDebtJournal\.forEach/);
  assert.match(sales, /const uniqueDebtJournal=debtJournal\.filter/);
  assert.match(sales, /reference\.includes\(String\(sale\.id\)\)/);
});

test('npm test descubre solo archivos de prueba y no scripts auxiliares', () => {
  const runner = read('scripts/run-tests.cjs');
  const packageJson = read('package.json');
  assert.match(runner, /readdirSync\(testDirectory\)/);
  assert.match(runner, /name\.endsWith\('\.test\.cjs'\)/);
  assert.match(packageJson, /"test": "node scripts\/run-tests\.cjs"/);
});

test('inventario normaliza acentos y recupera filtros desde productos reales', () => {
  const source = read('src/components/modules/InventoryModule.tsx');
  assert.match(source, /normalizeCatalogFilter/);
  assert.match(source, /state\.departamentos[^\n]*state\.productos/);
  assert.match(source, /state\.categorias[^\n]*state\.productos/);
  assert.match(source, /normalizeCatalogFilter\(p\.categoria\) === normalizeCatalogFilter\(catFilter\)/);
  assert.match(source, /normalizeCatalogFilter\(p\.departamento\) === normalizeCatalogFilter\(deptFilter\)/);
  assert.doesNotMatch(source, /DEFAULT_DEPARTMENTS|DEFAULT_CATEGORIES/);
});

test('importación de catálogos es exclusiva, administrativa y no sustituye la restauración completa', () => {
  const route = read('src/app/api/pos/catalogs-import/route.ts');
  const client = read('src/lib/backup.ts');
  const settings = read('src/components/modules/ConfigModule.tsx');
  const store = read('src/lib/sqlite/pos-store.ts');
  assert.match(route, /user\.rol !== 'administrador'/);
  assert.match(route, /IMPORTAR_SOLO_CATALOGOS/);
  assert.match(store, /mergeCatalogsOnlyImportTransaction/);
  assert.match(store, /sqliteInteractiveTransaction/);
  assert.match(client, /previsualizarCatalogosDesdeArchivo/);
  assert.match(client, /importarCatalogosDesdeArchivo/);
  assert.match(settings, /Importar solo catálogos/);
  assert.match(settings, /Productos, existencias, movimientos, ventas, compras, CxC, CxP y caja no serán modificados/);
});

test('rentabilidad usa el costo histórico capturado en la venta y no el costo actual del catálogo', () => {
  const reports = read('src/components/modules/ReportsModule.tsx');
  const start = reports.indexOf('// Rentabilidad histórica:');
  const end = reports.indexOf('const reportesZFiltrados', start);
  assert.ok(start >= 0 && end > start, 'debe existir el bloque de rentabilidad histórica');
  const profitability = reports.slice(start, end);
  assert.match(profitability, /item\?\.costoUnitarioUSD/);
  assert.match(profitability, /unitCost \* quantity/);
  assert.doesNotMatch(profitability, /state\.productos\.find/);
  assert.match(profitability, /missingHistoricalCostLines/);
  assert.match(profitability, /costoHistoricoCompleto/);
  assert.match(profitability, /ventaLibreBS/);
  assert.match(reports, /NO DISPONIBLE/);
  assert.match(reports, /líneas con costo histórico/);
});

test('el costo histórico de kits refleja sus componentes y el margen excluye IVA', () => {
  const store = read('src/lib/sqlite/pos-store.ts');
  const reports = read('src/components/modules/ReportsModule.tsx');
  assert.match(store, /product\.kitType === 'stock_componentes'/);
  assert.match(store, /kitItem\.cantidad/);
  assert.match(store, /unitCostUSD/);
  assert.match(reports, /Number\(sale\.totalUSD\)[\s\S]{0,100}Number\(sale\.ivaUSD\)/);
  assert.match(reports, /Ganancia Bruta/);
  assert.match(reports, /Margen Bruto/);
  assert.doesNotMatch(reports, /Margen de Ganancia Neta/);
});

test('los informes de ajustes, consumo y colaboraciones usan el costo histórico del movimiento', () => {
  const inventory = read('src/components/modules/InventoryModule.tsx');
  const adjustmentsStart = inventory.indexOf('function HistorialAjustes');
  const consumptionStart = inventory.indexOf('function ReporteConsumo');
  const kardexStart = inventory.indexOf('function ReporteKardex');
  assert.ok(adjustmentsStart >= 0 && consumptionStart > adjustmentsStart && kardexStart > consumptionStart);
  const adjustments = inventory.slice(adjustmentsStart, consumptionStart);
  const consumption = inventory.slice(consumptionStart, kardexStart);
  for (const report of [adjustments, consumption]) {
    assert.match(report, /costoUnitarioUSD/);
    assert.match(report, /hasHistoricalCost/);
    assert.match(report, /missingHistoricalCostMovements/);
    assert.doesNotMatch(report, /p\?\.costoUSD|p\.costoUSD/);
    assert.match(report, /SIN HISTÓRICO/);
  }
  assert.match(adjustments, /Number\(movement\.cantidad\) \* Number\(movement\.costoUnitarioUSD\)/);
  assert.match(consumption, /Math\.abs\(Number\(movement\.cantidad\)\) \* Number\(movement\.costoUnitarioUSD\)/);
});

test('una entrada manual con costo nuevo conserva ese costo como snapshot histórico', () => {
  const inventory = read('src/components/modules/InventoryModule.tsx');
  assert.match(inventory, /movementCostUSD = mov\.tipo === 'ajuste_entrada' && Number\(nuevoCosto\) > 0/);
  assert.match(inventory, /costoUnitarioUSD: movementCostUSD/);
  assert.match(inventory, /costoUnitarioBs: movementCostUSD \* movementRate/);
});
