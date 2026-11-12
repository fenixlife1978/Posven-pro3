const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posven3-sqlite-test-'));
process.env.POSVEN_SQLITE_PATH = path.join(tempDir, 'posven3-test.sqlite');

// Load the real TypeScript SQLite modules without adding a runtime dependency.
require.extensions['.ts'] = (loadedModule, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  loadedModule._compile(output, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveTypeScript(request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (error) {
    if (typeof request === 'string' && !path.extname(request)) {
      return originalResolveFilename.call(this, request + '.ts', parent, isMain, options);
    }
    throw error;
  }
};

const sqlite = require('../src/lib/sqlite/client.ts');
const { sqliteExecute, sqliteInteractiveTransaction, assertSQLiteReady } = sqlite;
const database = require('../src/lib/sqlite/database.ts');

test('transacciones interactivas serializan cajas concurrentes en una sola conexión', async () => {
  assertSQLiteReady();
  await sqliteExecute({
    sql: 'CREATE TABLE IF NOT EXISTS regression_events (id TEXT PRIMARY KEY, event TEXT NOT NULL)',
    wantRows: false,
  });

  let releaseFirst;
  let signalFirstEntered;
  const firstEntered = new Promise(resolve => { signalFirstEntered = resolve; });
  const holdFirst = new Promise(resolve => { releaseFirst = resolve; });
  const order = [];

  const first = sqliteInteractiveTransaction(async tx => {
    await tx.execute({
      sql: 'INSERT INTO regression_events(id,event) VALUES(?,?)',
      args: ['first-start', 'first-start'],
      wantRows: false,
    });
    order.push('first-enter');
    signalFirstEntered();
    await holdFirst;
    await tx.execute({
      sql: 'INSERT INTO regression_events(id,event) VALUES(?,?)',
      args: ['first-end', 'first-end'],
      wantRows: false,
    });
    order.push('first-exit');
  });

  await firstEntered;
  const second = sqliteInteractiveTransaction(async tx => {
    order.push('second-enter');
    await tx.execute({
      sql: 'INSERT INTO regression_events(id,event) VALUES(?,?)',
      args: ['second', 'second'],
      wantRows: false,
    });
  });

  // Give the second request a chance to queue behind the open transaction.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['first-enter']);

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-enter', 'first-exit', 'second-enter']);

  const rows = await sqliteExecute({
    sql: 'SELECT id FROM regression_events ORDER BY rowid',
  });
  assert.deepEqual(rows.rows.map(row => row.id), ['first-start', 'first-end', 'second']);
});

test('una excepción revierte todos los cambios de la transacción', async () => {
  await assert.rejects(
    sqliteInteractiveTransaction(async tx => {
      await tx.execute({
        sql: 'INSERT INTO regression_events(id,event) VALUES(?,?)',
        args: ['must-rollback', 'temporary'],
        wantRows: false,
      });
      throw new Error('fallo de prueba');
    }),
    /fallo de prueba/,
  );

  const result = await sqliteExecute({
    sql: 'SELECT COUNT(*) AS total FROM regression_events WHERE id=?',
    args: ['must-rollback'],
  });
  assert.equal(Number(result.rows[0].total), 0);
});

test('el contexto transaccional no permite ejecutar después del COMMIT', async () => {
  let closedTransaction;
  await sqliteInteractiveTransaction(async tx => {
    closedTransaction = tx;
    await tx.execute({ sql: 'SELECT 1 AS ok' });
  });

  await assert.rejects(
    closedTransaction.execute({ sql: 'SELECT 1 AS ok' }),
    /transacción SQLite ya fue cerrada/,
  );
});

after(() => {
  try { database.closeSqliteDatabase(); } catch {}
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});
