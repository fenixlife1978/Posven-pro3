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
