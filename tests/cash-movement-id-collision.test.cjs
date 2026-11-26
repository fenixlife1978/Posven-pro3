const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const store = fs.readFileSync(path.join(__dirname, '..', 'src/lib/sqlite/pos-store.ts'), 'utf8');
const start = store.indexOf('function createCashMovementTransaction');
const end = store.indexOf('function reverseDebtPaymentTransaction', start);
const cashMovement = store.slice(start, end);

test('un movimiento de caja no puede sobrescribir un asiento previo con el mismo ID', () => {
  assert.match(cashMovement, /const existingJournalEntry[\s\S]*?txSelect\('libroDiario',String\(movement\.id\)\)/);
  assert.match(cashMovement, /if\(existingJournalEntry\) throw new Error[\s\S]*?No se sobrescribió el asiento previo/);
  assert.ok(cashMovement.indexOf('if(existingJournalEntry)') < cashMovement.indexOf('rowStatement(\'libroDiario\', canonicalMovement)'));
});
