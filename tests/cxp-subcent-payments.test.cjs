const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cxp = fs.readFileSync(path.join(__dirname, '..', 'src/components/modules/CxPModule.tsx'), 'utf8');
const store = fs.readFileSync(path.join(__dirname, '..', 'src/lib/sqlite/pos-store.ts'), 'utf8');

test('CxP individual payments preserve bolivar cents and the applied exchange rate', () => {
  assert.match(cxp, /const amountNormalizado = esMetodoBS[\s\S]*?1000000[\s\S]*?: Math\.round\(\(amount \+ Number\.EPSILON\) \* 100\) \/ 100/);
  assert.match(cxp, /metodo: paymentMethod, reciboId, tasaAplicada/);
  assert.match(cxp, /amountBS: montoBS,[\s\S]*?payment: \{ \.\.\.pago/);
  assert.match(store, /const esPagoBsCxp = collection === 'cxp'/);
  assert.match(store, /if \(esPagoBsCxp \? !\(Number\(amountBS\) > 0\) : !\(Number\(amountUSD\) > 0\)\)/);
  assert.match(store, /const saldoBSExacto = esPagoBsCxp/);
  assert.match(store, /const saldoFinal = esPagoBsCxp && appliedBS >= saldoBSExacto - 0\.005/);
});

test('CxP global payments can apply a valid Bs amount below one USD cent', () => {
  assert.match(cxp, /amountBS: montoBS,[\s\S]*?payment: pagoBase/);
  assert.match(cxp, /esMetodoBS \? aplicadoBS <= 0 : totalAplicado <= 0\.001/);
  assert.match(store, /const esPagoBsCxpInicial=collection==='cxp'/);
  assert.match(store, /let remCents=esPagoBsCxp\?0:/);
  assert.match(store, /if\(esPagoBsCxp \? appliedBS<=0\.0000005 : appliedUSD<=0\.000001\)/);
  assert.match(store, /saldoNuevo=esPagoBsCxp[\s\S]*?1000000/);
});
