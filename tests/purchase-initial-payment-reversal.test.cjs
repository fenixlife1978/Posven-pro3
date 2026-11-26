const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const store = fs.readFileSync(path.join(__dirname, '..', 'src/lib/sqlite/pos-store.ts'), 'utf8');
const start = store.indexOf('function deletePurchaseTransaction');
const end = store.indexOf('function deleteCustomerDebtTransaction', start);
const deletion = store.slice(start, end);

test('eliminar compra permite revertir solo el abono inicial de contado y rechaza abonos posteriores', () => {
  assert.match(deletion, /historialPagos[\s\S]*?some\(\(p:any\)=>String\(p\?\.reciboId\|\|''\)!=='INICIAL-CONTADO'\)/);
  assert.match(deletion, /No se puede eliminar una compra con CxP que conserva abonos posteriores/);
  assert.match(deletion, /const paymentJournalIds[\s\S]*?historialPagos[\s\S]*?asientoId/);
  assert.match(deletion, /const paymentJournals[\s\S]*?libro_diario[\s\S]*?const journals=/);
  assert.doesNotMatch(deletion, /historialPagos\)&&d\.historialPagos\.length>0/);
});

test('la compra valida total de líneas, pagado, saldo, CxP y asiento inicial dentro de SQLite', () => {
  const startCreate = store.indexOf('function createPurchaseTransaction');
  const endCreate = store.indexOf('function deletePurchaseTransaction', startCreate);
  const create = store.slice(startCreate, endCreate);
  assert.match(create, /subtotal-quantity\*cost/);
  assert.match(create, /totalCompraUSD[\s\S]*?totalLineasUSD/);
  assert.match(create, /pagadoUSD[\s\S]*?saldoEsperadoUSD/);
  assert.match(create, /debt\.montoUSD[\s\S]*?debt\.abonadoUSD[\s\S]*?debt\.saldoUSD/);
  assert.match(create, /journal\.montoUSD[\s\S]*?pagadoUSD/);
  assert.match(create, /initialPayments\.length!==1[\s\S]*?initialPayment\.asientoId/);
});

test('la apertura de caja rechaza fondos negativos, no finitos o vacíos', () => {
  const start = store.indexOf('function patchTerminalTransaction');
  const end = store.indexOf('export async function upsertTerminalTransaction', start);
  const patch = store.slice(start, end);
  assert.match(patch, /openingBS[\s\S]*?openingUSD[\s\S]*?openingBS<0[\s\S]*?openingUSD<0/);
  assert.match(patch, /openingBS>0\|\|openingUSD>0/);
});
