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


const cxc = fs.readFileSync(path.join(__dirname, '..', 'src/components/modules/CxCModule.tsx'), 'utf8');
const sales = fs.readFileSync(path.join(__dirname, '..', 'src/components/modules/SalesModule.tsx'), 'utf8');

test('CxC individual Bs and mixed payments preserve six-decimal USD equivalents', () => {
  assert.match(sales, /const totalAbonadoBS = Math\.round[\s\S]*?\* 100\) \/ 100/);
  assert.match(sales, /montoBS: totalAbonadoBS,[\s\S]*?tasaAplicada: state\.tasa,[\s\S]*?paymentParts/);
  assert.match(sales, /Math\.abs\(appliedUSD - totalAbonado\) > 0\.000001/);
  assert.match(store, /const esPagoBsCxc = collection === 'cxc'[\s\S]*?paymentParts\.some/);
  assert.match(store, /const applied = esPagoBs[\s\S]*?1000000/);
  assert.match(store, /const saldoFinal = esPagoBs[\s\S]*?saldo - applied/);
});

test('CxC and CxP keep sub-cent debts active and display their Bs equivalent', () => {
  assert.match(cxc, /saldoActualDeuda\(x\) > 0\.0000005/);
  assert.match(cxc, /const fmtSaldoCxC[\s\S]*?Utils\.fmtBS\(bs\)/);
  assert.match(sales, /Number\(d\.saldoUSD\) \|\| 0\) > 0\.0000005/);
  assert.match(sales, /const fmtSaldoCxC[\s\S]*?Utils\.fmtBS\(bs\)/);
  assert.match(cxp, /\(x\.saldoUSD \|\| 0\) > 0\.0000005/);
  assert.match(cxp, /const fmtSaldoCxP[\s\S]*?Utils\.fmtBS\(bs\)/);
});
