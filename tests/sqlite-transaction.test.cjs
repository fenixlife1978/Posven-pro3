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
    if (typeof request === 'string' && request.startsWith('@/')) {
      const mapped = path.join(process.cwd(), 'src', request.slice(2));
      return originalResolveFilename.call(this, path.extname(mapped) ? mapped : mapped + '.ts', parent, isMain, options);
    }
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
const schema = require('../src/lib/sqlite/schema-init.ts');
const posStore = require('../src/lib/sqlite/pos-store.ts');

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
  try {
    assert.deepEqual(order, ['first-enter']);
  } finally {
    // Never leave the first transaction suspended if an assertion fails.
    releaseFirst();
  }
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


test('dos cajas mantienen ventas y Corte Z independientes; reintentar el mismo cierre no duplica el Z', async () => {
  await schema.ensureSqliteSchema();

  const openedAt = '2026-11-12T10:00:00.000Z';
  const saleAt = '2026-11-12T11:00:00.000Z';
  const terminals = [
    {
      id: 'CAJA1', nombre: 'Caja 1', prefijoCaja: 'CAJA01',
      isCashOpen: true, cashData: { openDate: openedAt, openedBy: 'Prueba' },
      ultimoZ: 0, fechaUltimoZ: '', acumuladoHistorico: 0,
      fondoCajaHoyBS: 0, fondoCajaHoyUSD: 0, cashHistory: [],
    },
    {
      id: 'CAJA2', nombre: 'Caja 2', prefijoCaja: 'CAJA02',
      isCashOpen: true, cashData: { openDate: openedAt, openedBy: 'Prueba' },
      ultimoZ: 0, fechaUltimoZ: '', acumuladoHistorico: 0,
      fondoCajaHoyBS: 0, fondoCajaHoyUSD: 0, cashHistory: [],
    },
  ];

  for (const terminal of terminals) {
    await sqliteExecute({
      sql: 'INSERT INTO terminales(id,data_json,fecha) VALUES(?,?,?)',
      args: [terminal.id, JSON.stringify(terminal), openedAt],
      wantRows: false,
    });
  }

  const sales = [
    {
      id: 'V-CAJA1-000000001', fecha: saleAt, estado: 'completada', terminalId: 'CAJA1',
      totalUSD: 10, totalBS: 0, descuentoUSD: 0, baseImponibleUSD: 10,
      ivaUSD: 0, exentoUSD: 0, igtfUSD: 0, metodoPago: 'efectivo_usd',
      payments: [{ metodo: 'efectivo_usd', montoUSD: 10, montoBS: 0 }], type: 'VENTA',
    },
    {
      id: 'V-CAJA2-000000001', fecha: saleAt, estado: 'completada', terminalId: 'CAJA2',
      totalUSD: 25, totalBS: 0, descuentoUSD: 0, baseImponibleUSD: 25,
      ivaUSD: 0, exentoUSD: 0, igtfUSD: 0, metodoPago: 'efectivo_usd',
      payments: [{ metodo: 'efectivo_usd', montoUSD: 25, montoBS: 0 }], type: 'VENTA',
    },
  ];
  for (const sale of sales) {
    await sqliteExecute({
      sql: 'INSERT INTO ventas(id,data_json,fecha) VALUES(?,?,?)',
      args: [sale.id, JSON.stringify(sale), sale.fecha],
      wantRows: false,
    });
  }

  const user = { id: 'admin-regression', rol: 'administrador', nombre: 'Prueba' };
  const close = (terminalId, countedUsd) => posStore.createZClosureTransaction({
    user,
    terminalId,
    report: { arqueoReal: { efectivo_usd: countedUsd } },
    terminalPatch: {},
  });

  const [firstCaja1, retryCaja1, firstCaja2] = await Promise.all([
    close('CAJA1', 10),
    close('CAJA1', 10),
    close('CAJA2', 25),
  ]);

  assert.equal(firstCaja1.report.id, retryCaja1.report.id);
  assert.equal(firstCaja1.report.numeroZ, 1);
  assert.equal(firstCaja2.report.numeroZ, 1);
  assert.notEqual(firstCaja1.report.id, firstCaja2.report.id);
  assert.equal(firstCaja1.report.ventaBrutaUSD, 10);
  assert.equal(firstCaja2.report.ventaBrutaUSD, 25);
  assert.equal(firstCaja1.terminal.isCashOpen, false);
  assert.equal(firstCaja2.terminal.isCashOpen, false);

  const reports = await sqliteExecute({
    sql: 'SELECT id,data_json FROM reportes_z ORDER BY id',
  });
  assert.equal(reports.rows.length, 2);
  const operations = await sqliteExecute({
    sql: "SELECT operation_id FROM operaciones WHERE prefijo='CIERRE-Z' ORDER BY operation_id",
  });
  assert.equal(operations.rows.length, 2);
  assert.equal(new Set(operations.rows.map(row => row.operation_id)).size, 2);
});

after(() => {
  try { database.closeSqliteDatabase(); } catch {}
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});


test('un Corte Z inválido revierte todo y permite reintentar sin dejar la caja cerrada', async () => {
  await schema.ensureSqliteSchema();

  const openedAt = '2026-11-12T12:00:00.000Z';
  const saleAt = '2026-11-12T12:30:00.000Z';
  const terminal = {
    id: 'CAJA3', nombre: 'Caja 3', prefijoCaja: 'CAJA03',
    isCashOpen: true, cashData: { openDate: openedAt, openedBy: 'Prueba' },
    ultimoZ: 0, fechaUltimoZ: '', acumuladoHistorico: 0,
    fondoCajaHoyBS: 0, fondoCajaHoyUSD: 0, cashHistory: [],
  };
  await sqliteExecute({
    sql: 'INSERT INTO terminales(id,data_json,fecha) VALUES(?,?,?)',
    args: [terminal.id, JSON.stringify(terminal), openedAt],
    wantRows: false,
  });
  const sale = {
    id: 'V-CAJA3-000000001', fecha: saleAt, estado: 'completada', terminalId: 'CAJA3',
    totalUSD: 50, totalBS: 0, descuentoUSD: 0, baseImponibleUSD: 50,
    ivaUSD: 0, exentoUSD: 0, igtfUSD: 0, metodoPago: 'efectivo_usd',
    payments: [{ metodo: 'efectivo_usd', montoUSD: 50, montoBS: 0 }], type: 'VENTA',
  };
  await sqliteExecute({
    sql: 'INSERT INTO ventas(id,data_json,fecha) VALUES(?,?,?)',
    args: [sale.id, JSON.stringify(sale), sale.fecha],
    wantRows: false,
  });

  const user = { id: 'admin-regression', rol: 'administrador', nombre: 'Prueba' };
  const close = (arqueoReal) => posStore.createZClosureTransaction({
    user,
    terminalId: 'CAJA3',
    report: { arqueoReal },
    terminalPatch: {},
  });
  const reportsBefore = await sqliteExecute({ sql: 'SELECT COUNT(*) AS total FROM reportes_z' });
  const operationsBefore = await sqliteExecute({
    sql: "SELECT COUNT(*) AS total FROM operaciones WHERE prefijo='CIERRE-Z'",
  });

  await assert.rejects(close({}), /Falta registrar el conteo real del medio de pago: efectivo_usd/);
  let savedTerminal = await sqliteExecute({
    sql: 'SELECT data_json FROM terminales WHERE id=?',
    args: ['CAJA3'],
  });
  assert.equal(JSON.parse(savedTerminal.rows[0].data_json).isCashOpen, true);
  assert.equal(Number((await sqliteExecute({ sql: 'SELECT COUNT(*) AS total FROM reportes_z' })).rows[0].total), Number(reportsBefore.rows[0].total));
  assert.equal(Number((await sqliteExecute({
    sql: "SELECT COUNT(*) AS total FROM operaciones WHERE prefijo='CIERRE-Z'",
  })).rows[0].total), Number(operationsBefore.rows[0].total));

  await assert.rejects(close({ efectivo_usd: -1 }), /monto inválido o negativo/);
  savedTerminal = await sqliteExecute({
    sql: 'SELECT data_json FROM terminales WHERE id=?',
    args: ['CAJA3'],
  });
  assert.equal(JSON.parse(savedTerminal.rows[0].data_json).isCashOpen, true);

  const successful = await close({ efectivo_usd: 50 });
  assert.equal(successful.report.numeroZ, 1);
  assert.equal(successful.report.ventaBrutaUSD, 50);
  assert.equal(successful.terminal.isCashOpen, false);
  const reportsAfter = await sqliteExecute({ sql: 'SELECT COUNT(*) AS total FROM reportes_z' });
  const operationsAfter = await sqliteExecute({
    sql: "SELECT COUNT(*) AS total FROM operaciones WHERE prefijo='CIERRE-Z'",
  });
  assert.equal(Number(reportsAfter.rows[0].total), Number(reportsBefore.rows[0].total) + 1);
  assert.equal(Number(operationsAfter.rows[0].total), Number(operationsBefore.rows[0].total) + 1);
});
