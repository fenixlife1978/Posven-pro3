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
