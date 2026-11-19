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
const auth = require('../src/lib/sqlite/auth.ts');

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

test('devolver y anular un kit repone sus componentes, no el artículo padre', async () => {
  await schema.ensureSqliteSchema();

  const openedAt = '2026-11-14T09:00:00.000Z';
  const saleAt = '2026-11-14T10:00:00.000Z';
  const returnAt = '2026-11-14T10:30:00.000Z';
  const cancelAt = '2026-11-14T11:00:00.000Z';
  const terminal = {
    id: 'KITBOX', nombre: 'Caja Kits', prefijoCaja: 'KITBOX',
    usuarioId: 'admin-kit-regression', isCashOpen: true,
    cashData: { openDate: openedAt, openedBy: 'Prueba' },
    proximoRecibo: 1, proximaDevolucion: 1, proximaAnulacion: 1,
    ultimoZ: 0, fechaUltimoZ: '', acumuladoHistorico: 0,
    fondoCajaHoyBS: 0, fondoCajaHoyUSD: 0, cashHistory: [],
  };
  await sqliteExecute({
    sql: 'INSERT INTO terminales(id,data_json,fecha) VALUES(?,?,?)',
    args: [terminal.id, JSON.stringify(terminal), openedAt],
    wantRows: false,
  });

  const products = [
    {
      id: 'KIT-PACK', nombre: 'Kit de prueba', stock: 5,
      isKit: true, kitType: 'stock_componentes',
      kitItems: [{ productoId: 'KIT-COMP', cantidad: 2 }],
      costoUSD: 3,
    },
    { id: 'KIT-COMP', nombre: 'Componente', stock: 10, costoUSD: 1 },
  ];
  for (const product of products) {
    await sqliteExecute({
      sql: 'INSERT INTO productos(id,data_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)',
      args: [product.id, JSON.stringify(product)],
      wantRows: false,
    });
  }

  const user = { id: 'admin-kit-regression', rol: 'administrador', nombre: 'Prueba' };
  const saleResult = await posStore.createSaleTransaction({
    operationId: 'KIT-SALE-REGRESSION',
    cart: [{
      productoId: 'KIT-PACK', nombre: 'Kit de prueba', cantidad: 2,
      precioUnitUSD: 10, subtotalUSD: 20,
    }],
    payments: [{ metodo: 'efectivo_usd', montoUSD: 20, montoBS: 0 }],
    clientName: 'CONTADO',
    terminalId: 'KITBOX',
    now: saleAt,
    tasa: 1,
    user,
  });

  assert.equal(saleResult.sale.id, 'KITBOX-V-000000001');
  let parent = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: ['KIT-PACK'] });
  let component = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: ['KIT-COMP'] });
  assert.equal(JSON.parse(parent.rows[0].data_json).stock, 5);
  assert.equal(JSON.parse(component.rows[0].data_json).stock, 6);

  const returnedItem = {
    productoId: 'KIT-PACK', nombre: 'Kit de prueba', cantidad: 1,
    precioUnitUSD: 10, subtotalUSD: 10, estadoProducto: 'REINTEGRADO_STOCK',
  };
  await posStore.processReturnOrCancellationTransaction({
    operationId: 'KIT-RETURN-REGRESSION',
    operationType: 'DEVOLUCION',
    saleId: saleResult.sale.id,
    operationDoc: { id: 'DEV-TEMP', fecha: returnAt, items: [returnedItem] },
    movements: [],
    refundItems: [returnedItem],
    terminalId: 'KITBOX',
    user,
  });

  parent = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: ['KIT-PACK'] });
  component = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: ['KIT-COMP'] });
  assert.equal(JSON.parse(parent.rows[0].data_json).stock, 5);
  assert.equal(JSON.parse(component.rows[0].data_json).stock, 8);

  await posStore.processReturnOrCancellationTransaction({
    operationId: 'KIT-CANCEL-REGRESSION',
    operationType: 'ANULACION',
    saleId: saleResult.sale.id,
    operationDoc: { id: 'ANU-TEMP', fecha: cancelAt, items: [] },
    movements: [],
    refundItems: [],
    terminalId: 'KITBOX',
    user,
  });

  parent = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: ['KIT-PACK'] });
  component = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: ['KIT-COMP'] });
  assert.equal(JSON.parse(parent.rows[0].data_json).stock, 5);
  assert.equal(JSON.parse(component.rows[0].data_json).stock, 10);

  const saleMovements = await sqliteExecute({
    sql: "SELECT data_json FROM movimientos WHERE json_extract(data_json,'$.productoId')=? ORDER BY fecha,id",
    args: ['KIT-COMP'],
  });
  const deltas = saleMovements.rows.map(row => {
    const movement = JSON.parse(row.data_json);
    return Number(movement.stockDespues) - Number(movement.stockAntes);
  });
  assert.equal(deltas.reduce((sum, delta) => sum + delta, 0), 0);
  assert.equal(deltas.length, 3);
});


test('el límite de inicio de sesión se aplica por usuario y origen, sin bloquear otras cajas de la misma red', async () => {
  await schema.ensureSqliteSchema();
  const origin = '192.168.10.20';
  for (let i = 0; i < 5; i++) {
    const result = await auth.consumeLoginAttempt('cajero-a', origin, new Date('2026-11-15T03:00:00.000Z'));
    assert.equal(result.allowed, true);
  }

  const blocked = await auth.consumeLoginAttempt('cajero-a', origin, new Date('2026-11-15T03:00:01.000Z'));
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);

  const otherCashier = await auth.consumeLoginAttempt('cajero-b', origin, new Date('2026-11-15T03:00:01.000Z'));
  assert.equal(otherCashier.allowed, true);

  const otherOrigin = await auth.consumeLoginAttempt('cajero-a', '192.168.10.21', new Date('2026-11-15T03:00:01.000Z'));
  assert.equal(otherOrigin.allowed, true);
});

test('el contador de login se reinicia al vencer la ventana y se limpia después de autenticar', async () => {
  await schema.ensureSqliteSchema();
  const start = new Date('2026-11-15T04:00:00.000Z');
  for (let i = 0; i < 5; i++) {
    await auth.consumeLoginAttempt('usuario-inexistente', '10.0.0.8', start);
  }

  const afterWindow = await auth.consumeLoginAttempt(
    'usuario-inexistente',
    '10.0.0.8',
    new Date(start.getTime() + 16 * 60 * 1000),
  );
  assert.equal(afterWindow.allowed, true);

  await auth.clearLoginAttempts('usuario-inexistente', '10.0.0.8');
  const afterSuccess = await auth.consumeLoginAttempt(
    'usuario-inexistente',
    '10.0.0.8',
    new Date(start.getTime() + 16 * 60 * 1000 + 1000),
  );
  assert.equal(afterSuccess.allowed, true);

  const stored = await sqliteExecute({ sql: 'SELECT identifier_key, origin_key FROM auth_login_attempts' });
  assert.ok(stored.rows.every(row =>
    !String(row.identifier_key).includes('usuario-inexistente') &&
    !String(row.origin_key).includes('10.0.0.8')
  ));
});

test('los intentos concurrentes no superan el límite por usuario y origen', async () => {
  await schema.ensureSqliteSchema();
  const now = new Date('2026-11-15T05:00:00.000Z');
  const results = await Promise.all(
    Array.from({ length: 9 }, () => auth.consumeLoginAttempt('concurrente', '172.16.0.5', now)),
  );
  assert.equal(results.filter(result => result.allowed).length, 5);
  assert.equal(results.filter(result => !result.allowed).length, 4);
});

test('executeBatch reutiliza sentencias y conserva el orden dentro de una transacción', async () => {
  await sqliteInteractiveTransaction(async tx => {
    await tx.execute({ sql: 'CREATE TABLE IF NOT EXISTS batch_regression (id TEXT PRIMARY KEY, value TEXT)', wantRows: false });
    await tx.executeBatch([
      { sql: 'INSERT OR REPLACE INTO batch_regression(id,value) VALUES(?,?)', args: ['batch-1', 'uno'], wantRows: false },
      { sql: 'INSERT OR REPLACE INTO batch_regression(id,value) VALUES(?,?)', args: ['batch-2', 'dos'], wantRows: false },
      { sql: 'INSERT OR REPLACE INTO batch_regression(id,value) VALUES(?,?)', args: ['batch-3', 'tres'], wantRows: false },
    ]);
  });
  const rows = await sqliteExecute({ sql: 'SELECT id,value FROM batch_regression ORDER BY id' });
  assert.deepEqual(rows.rows.map(row => [row.id, row.value]), [['batch-1', 'uno'], ['batch-2', 'dos'], ['batch-3', 'tres']]);
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
  const terminalAfterNegative = JSON.parse(savedTerminal.rows[0].data_json);
  assert.equal(terminalAfterNegative.isCashOpen, true);
  assert.equal(terminalAfterNegative.ultimoZ, 0);
  assert.equal(terminalAfterNegative.cashHistory.length, 0);
  assert.equal(Number((await sqliteExecute({ sql: 'SELECT COUNT(*) AS total FROM reportes_z' })).rows[0].total), Number(reportsBefore.rows[0].total));
  assert.equal(Number((await sqliteExecute({
    sql: "SELECT COUNT(*) AS total FROM operaciones WHERE prefijo='CIERRE-Z'",
  })).rows[0].total), Number(operationsBefore.rows[0].total));

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


test('las lecturas POS de cajero quedan limitadas a sus terminales asignadas', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-14T12:00:00.000Z';
  const terminals = [
    { id: 'READ-CAJA-A', usuarioId: 'read-cashier-a', nombre: 'Caja A' },
    { id: 'READ-CAJA-B', usuarioId: 'read-cashier-b', nombre: 'Caja B' },
  ];
  for (const terminal of terminals) {
    await sqliteExecute({
      sql: 'INSERT OR REPLACE INTO terminales(id,data_json,fecha) VALUES(?,?,?)',
      args: [terminal.id, JSON.stringify(terminal), at],
      wantRows: false,
    });
  }
  const sales = [
    { id: 'READ-SALE-A', fecha: at, terminalId: 'READ-CAJA-A', estado: 'completada', totalUSD: 12 },
    { id: 'READ-SALE-B', fecha: at, terminalId: 'READ-CAJA-B', estado: 'completada', totalUSD: 99 },
  ];
  for (const sale of sales) {
    await sqliteExecute({
      sql: 'INSERT OR REPLACE INTO ventas(id,data_json,fecha) VALUES(?,?,?)',
      args: [sale.id, JSON.stringify(sale), at],
      wantRows: false,
    });
  }
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO movimientos(id,data_json,fecha) VALUES(?,?,?)',
    args: ['READ-STOCK-MOVEMENT-B', JSON.stringify({ id: 'READ-STOCK-MOVEMENT-B', productoId: 'READ-PRODUCT-SHARED', tipo: 'venta', terminalId: 'READ-CAJA-B', cantidad: 1 }), at],
    wantRows: false,
  });

  const refunds = [
    { id: 'READ-RETURN-A', fecha: at, ventaId: 'READ-SALE-A', totalUSD: 2 },
    { id: 'READ-RETURN-B', fecha: at, ventaId: 'READ-SALE-B', totalUSD: 8 },
  ];
  for (const refund of refunds) {
    await sqliteExecute({
      sql: 'INSERT OR REPLACE INTO devoluciones(id,data_json,fecha) VALUES(?,?,?)',
      args: [refund.id, JSON.stringify(refund), at],
      wantRows: false,
    });
  }

  const debts = [
    { id: 'READ-CXC-A', ventaId: 'READ-SALE-A', montoUSD: 12, saldoUSD: 12 },
    { id: 'READ-CXC-B', ventaId: 'READ-SALE-B', montoUSD: 99, saldoUSD: 99 },
    { id: 'READ-CXC-GLOBAL', cliente: 'Deuda inicial', montoUSD: 5, saldoUSD: 5 },
  ];
  for (const debt of debts) {
    await sqliteExecute({
      sql: 'INSERT OR REPLACE INTO cxc(id,data_json,fecha) VALUES(?,?,?)',
      args: [debt.id, JSON.stringify(debt), at],
      wantRows: false,
    });
  }
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxp(id,data_json,fecha) VALUES(?,?,?)',
    args: ['READ-CXP-ADMIN', JSON.stringify({ id: 'READ-CXP-ADMIN', proveedor: 'Proveedor privado', montoUSD: 100 }), at],
    wantRows: false,
  });

  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: ['READ-PRODUCT-SHARED', JSON.stringify({ id: 'READ-PRODUCT-SHARED', nombre: 'Producto compartido' }), at],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
    args: ['READ-CLIENT-SHARED', JSON.stringify({ id: 'READ-CLIENT-SHARED', nombre: 'Cliente compartido' }), at],
    wantRows: false,
  });

  const cashier = { id: 'read-cashier-a', rol: 'cajero' };
  assert.deepEqual(
    (await posStore.listRecords('ventas', { limit: 100 }, cashier)).map(row => row.id),
    ['READ-SALE-A'],
  );
  assert.equal(await posStore.getRecord('ventas', 'READ-SALE-B', cashier), null);
  assert.equal(await posStore.countRecords('ventas', cashier), 1);
  assert.deepEqual(
    (await posStore.listRecords('ventas', { limit: 100, terminalId: 'READ-CAJA-B' }, cashier)).map(row => row.id),
    ['READ-SALE-A'],
  );
  assert.ok(await posStore.getRecord('productos', 'READ-PRODUCT-SHARED', cashier));
  assert.ok(await posStore.getRecord('clientes', 'READ-CLIENT-SHARED', cashier));
  assert.ok(await posStore.getRecord('movimientos', 'READ-STOCK-MOVEMENT-B', cashier));
  assert.deepEqual(
    (await posStore.listRecords('devoluciones', { limit: 100 }, cashier)).map(row => row.id),
    ['READ-RETURN-A'],
  );
  assert.equal(await posStore.countRecords('devoluciones', cashier), 1);
  assert.deepEqual(
    (await posStore.listRecords('cxc', { limit: 100 }, cashier)).map(row => row.id).sort(),
    ['READ-CXC-A', 'READ-CXC-B', 'READ-CXC-GLOBAL'],
  );
  assert.ok(await posStore.getRecord('cxc', 'READ-CXC-B', cashier));
  assert.equal(await posStore.countRecords('cxc', cashier), 3);
  assert.deepEqual(
    (await posStore.listRecords('terminales', { limit: 100 }, cashier)).map(row => row.id),
    ['READ-CAJA-A'],
  );
  assert.equal(await posStore.countRecords('cxp', cashier), 0);
  assert.equal(await posStore.getRecord('cxp', 'READ-CXP-ADMIN', cashier), null);
  assert.ok(await posStore.getRecord('ventas', 'READ-SALE-B', { id: 'read-admin', rol: 'administrador' }));
  assert.ok(await posStore.countRecords('ventas', { id: 'read-admin', rol: 'administrador' }) >= 2);
});


test('cualquier cajero puede consultar y cobrar CxC originadas por otra terminal', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-15T01:00:00.000Z';
  const cashier = { id: 'scope-cashier-a', rol: 'cajero', nombre: 'Cajero A' };
  const terminal = {
    id: 'SCOPE-CAJA-A', usuarioId: cashier.id, nombre: 'Caja A', prefijoCaja: 'SCOPEA',
    isCashOpen: true, cashData: { openDate: at }, proximoCobroDeuda: 1,
  };
  const foreignSale = {
    id: 'SCOPE-SALE-B', fecha: at, terminalId: 'SCOPE-CAJA-B', estado: 'completada',
    items: [], totalUSD: 20,
  };
  const foreignDebt = {
    id: 'SCOPE-CXC-B', fecha: at, ventaId: foreignSale.id,
    cliente: 'Cliente Caja B', montoUSD: 20, abonadoUSD: 0, saldoUSD: 20,
    historialPagos: [],
  };
  const globalDebt = {
    id: 'SCOPE-CXC-GLOBAL', fecha: at, cliente: 'Deuda inicial',
    montoUSD: 10, abonadoUSD: 0, saldoUSD: 10, historialPagos: [],
  };
  for (const [table, row] of [
    ['terminales', terminal], ['ventas', foreignSale], ['cxc', foreignDebt], ['cxc', globalDebt],
  ]) {
    await sqliteExecute({
      sql: `INSERT OR REPLACE INTO ${table}(id,data_json,fecha) VALUES(?,?,?)`,
      args: [row.id, JSON.stringify(row), at], wantRows: false,
    });
  }

  assert.ok(await posStore.getRecord('cxc', foreignDebt.id, cashier));
  const foreignResult = await posStore.applyDebtPaymentTransaction({
    operationId: 'SCOPE-COLLECT-FOREIGN-CXC', collection: 'cxc', debtId: foreignDebt.id,
    amountUSD: 1, amountBS: 874.5,
    payment: { id: 'SCOPE-PAY-FOREIGN', montoUSD: 1, montoBS: 874.5, fecha: at, metodo: 'efectivo_bs' },
    journal: {
      id: 'SCOPE-JOURNAL-FOREIGN', fecha: at, tipo: 'ingreso', categoria: 'COBRO_DEUDA',
      concepto: 'ABONO CXC DE OTRA CAJA', montoUSD: 1, montoBS: 874.5,
      metodo: 'efectivo_bs', terminalId: terminal.id,
    },
    sale: {
      id: 'SCOPE-RECEIPT-FOREIGN', fecha: at, cliente: 'Cliente Caja B', terminalId: terminal.id,
      items: [{ productoId: 'ABONO', nombre: 'COBRO DE DEUDA', cantidad: 1, subtotalUSD: 1 }],
      totalUSD: 1, totalBS: 874.5, metodoPago: 'efectivo_bs',
      payments: [{ metodo: 'efectivo_bs', montoUSD: 1, montoBS: 874.5 }],
      estado: 'completada', type: 'COBRO DEUDA',
    },
    terminalId: terminal.id, user: cashier,
  });
  assert.equal(foreignResult.saldoUSD, 19);
  assert.equal(foreignResult.historialPagos.length, 1);
  assert.equal(foreignResult.payment.terminalId, terminal.id);
  assert.equal(foreignResult.sale.terminalId, terminal.id);
  assert.equal(foreignResult.sale.type, 'COBRO DEUDA');
  assert.deepEqual(foreignResult.sale.payments, [{ metodo: 'efectivo_bs', montoUSD: 1, montoBS: 874.5 }]);
  assert.equal(foreignResult.terminal.proximoCobroDeuda, 2);

  const savedReceipt = await posStore.getRecord('ventas', foreignResult.receiptId, { id: 'scope-admin', rol: 'administrador' });
  const savedJournal = await posStore.getRecord('libroDiario', 'SCOPE-JOURNAL-FOREIGN', { id: 'scope-admin', rol: 'administrador' });
  assert.equal(savedReceipt.terminalId, terminal.id);
  assert.equal(savedJournal.terminalId, terminal.id);
  assert.equal(savedJournal.referencia, foreignResult.receiptId);

  const globalResult = await posStore.applyDebtPaymentTransaction({
    operationId: 'SCOPE-COLLECT-GLOBAL-CXC', collection: 'cxc', debtId: globalDebt.id,
    amountUSD: 1, amountBS: 1, payment: { id: 'SCOPE-PAY-GLOBAL', montoUSD: 1, montoBS: 1, fecha: at, metodo: 'efectivo' },
    terminalId: terminal.id, user: cashier,
  });
  assert.equal(globalResult.saldoUSD, 9);
  assert.equal(globalResult.historialPagos.length, 1);
});


test('las respuestas de configuración ocultan secretos administrativos a cajeros', () => {
  const { configVisibleToRole } = posStore;
  const config = {
    tasa: 874.5,
    empresa: { nombre: 'Negocio de prueba' },
    pinDevolucion: '987654',
    claveAdministrativa: 'secreto',
    parametrosInternos: { modo: 'admin' },
  };
  assert.deepEqual(configVisibleToRole(config, 'cajero'), {
    tasa: 874.5,
    empresa: { nombre: 'Negocio de prueba' },
  });
  assert.equal(configVisibleToRole(config, 'cajero').pinDevolucion, undefined);
  assert.equal(configVisibleToRole(config, 'cajero').claveAdministrativa, undefined);
  assert.deepEqual(configVisibleToRole(config, 'administrador'), config);
});



test('el alta del primer administrador acepta correos válidos y rechaza sólo formatos inválidos', async () => {
  await schema.ensureSqliteSchema();
  assert.equal(await auth.needsFirstAdministrator(), true);

  for (const email of ['correo-sin-arroba', 'nombre@', '@empresa.com', 'nombre empresa@empresa.com']) {
    await assert.rejects(
      auth.createFirstAdministrator({
        username: 'admin-invalid',
        email,
        nombre: 'Administrador de Prueba',
        password: 'ClaveSegura123',
      }),
      /correo electrónico válido/,
    );
  }

  const valid = await auth.createFirstAdministrator({
    username: 'admin-regex',
    email: 'nombre.apellido+posven@empresa.com.ve',
    nombre: 'Administrador Regex',
    password: 'ClaveSegura123',
  });
  assert.equal(valid.email, 'nombre.apellido+posven@empresa.com.ve');
  assert.equal(valid.rol, 'administrador');
  assert.equal(valid.isSeedAdmin, true);
  assert.equal(await auth.needsFirstAdministrator(), false);

  // Reproduce installations created before is_seed_admin was set correctly:
  // restore must adopt the authenticated local administrator, not fail or
  // trust a user record supplied by the imported backup.
  const backup = await posStore.exportBackupSnapshot();
  await sqliteExecute({
    sql: 'UPDATE users SET is_seed_admin=0 WHERE id=?',
    args: [valid.id],
    wantRows: false,
  });
  const restore = await posStore.restoreBackupTransaction({
    user: { id: valid.id, rol: 'administrador' },
    backup,
  });
  assert.equal(restore.preservedAdminId, valid.id);
  const preserved = await auth.findUser(valid.username);
  assert.equal(preserved.isSeedAdmin, true);

  await assert.rejects(
    auth.createFirstAdministrator({
      username: 'otro-admin',
      email: 'otro@example.com',
      nombre: 'Segundo Administrador',
      password: 'ClaveSegura123',
    }),
    /ya fue configurado/,
  );
});

test('importación exclusiva de catálogos fusiona sin tocar productos ni inventario', async () => {
  await schema.ensureSqliteSchema();
  await posStore.patchCatalog('departamentos', ['Área de prueba POSVEN']);
  await posStore.patchCatalog('categorias', ['Categoría especial POSVEN']);

  await sqliteExecute({
    sql: 'INSERT INTO productos(id,data_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)',
    args: ['CATALOG-IMPORT-KEEP', JSON.stringify({ id: 'CATALOG-IMPORT-KEEP', nombre: 'Producto intacto', stock: 17 })],
    wantRows: false,
  });

  const result = await posStore.mergeCatalogsOnlyImportTransaction({
    departamentos: ['AREA DE PRUEBA POSVEN', 'Nueva área POSVEN'],
    categorias: ['categoria especial POSVEN', 'Nueva categoría POSVEN'],
  });

  assert.equal(result.plan.departamentos.added, 1);
  assert.equal(result.plan.categorias.added, 1);
  assert.ok(result.catalogs.departamentos.includes('Nueva área POSVEN'));
  assert.ok(result.catalogs.categorias.includes('Nueva categoría POSVEN'));

  const product = await sqliteExecute({
    sql: 'SELECT data_json FROM productos WHERE id=?',
    args: ['CATALOG-IMPORT-KEEP'],
  });
  assert.equal(JSON.parse(product.rows[0].data_json).stock, 17);
});


test('la administración de usuarios es atómica y protege al último administrador activo', async () => {
  await schema.ensureSqliteSchema();
  const seedResult = await sqliteExecute({
    sql: "SELECT id FROM users WHERE is_seed_admin=1 AND rol='administrador' LIMIT 1",
  });
  assert.ok(seedResult.rows[0], 'la prueba previa debe haber creado el administrador semilla');
  const seedId = String(seedResult.rows[0].id);
  const regular = await auth.createUser({
    username: 'admin-atomic-regression',
    email: 'admin-atomic-regression@example.test',
    nombre: 'Administrador Atómico',
    password: 'ClaveSegura123',
    rol: 'administrador',
  });

  // Con otro administrador activo, bloquear el seed admin es válido.
  await auth.setUserBlocked(seedId, true);
  await assert.rejects(
    auth.updateUser({ id: regular.id, rol: 'cajero' }),
    /último administrador activo/,
  );
  await assert.rejects(
    auth.deleteUser(regular.id),
    /último administrador activo/,
  );

  // Una edición inválida no puede dejar aplicado el bloqueo enviado junto a ella.
  await assert.rejects(
    auth.updateUser({ id: regular.id, nombre: '   ', accesoBloqueado: true }),
    /Datos de usuario inválidos/,
  );
  const unchanged = await auth.findUser(regular.username);
  assert.equal(unchanged.rol, 'administrador');
  assert.equal(unchanged.accesoBloqueado, false);

  // Restaurar el seed admin y comprobar que la operación combinada sí se aplica.
  await auth.setUserBlocked(seedId, false);
  await auth.updateUser({
    id: regular.id,
    nombre: 'Administrador Actualizado',
    accesoBloqueado: true,
  });
  const updated = await auth.findUser(regular.username);
  assert.equal(updated.nombre, 'Administrador Actualizado');
  assert.equal(updated.accesoBloqueado, true);
  await auth.deleteUser(regular.id);
});


test('dos solicitudes concurrentes no pueden degradar simultáneamente a los últimos administradores', async () => {
  const seedResult = await sqliteExecute({
    sql: "SELECT id FROM users WHERE is_seed_admin=1 AND rol='administrador' LIMIT 1",
  });
  const seedId = String(seedResult.rows[0].id);
  const first = await auth.createUser({
    username: 'admin-race-one', email: 'admin-race-one@example.test',
    nombre: 'Admin Race Uno', password: 'ClaveSegura123', rol: 'administrador',
  });
  const second = await auth.createUser({
    username: 'admin-race-two', email: 'admin-race-two@example.test',
    nombre: 'Admin Race Dos', password: 'ClaveSegura123', rol: 'administrador',
  });

  await auth.setUserBlocked(seedId, true);
  const outcomes = await Promise.allSettled([
    auth.updateUser({ id: first.id, rol: 'cajero' }),
    auth.updateUser({ id: second.id, rol: 'cajero' }),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);

  const remaining = await sqliteExecute({
    sql: "SELECT COUNT(*) AS total FROM users WHERE rol='administrador' AND acceso_bloqueado=0",
  });
  assert.equal(Number(remaining.rows[0].total), 1);

  await auth.setUserBlocked(seedId, false);
  await auth.deleteUser(first.id);
  await auth.deleteUser(second.id);
});


test('la sincronización genérica de clientes no puede alterar saldos financieros de CxC', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T12:00:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CLIENT-DEBT-PROTECTED', JSON.stringify({
      id: 'CLIENT-DEBT-PROTECTED', name: 'Cliente con deuda', cedula: 'V-100',
      phone: '000', debt: 125.5,
    }), at],
    wantRows: false,
  });

  const result = await posStore.syncRecords({
    table: 'clientes',
    records: [
      { id: 'CLIENT-DEBT-PROTECTED', name: 'Cliente actualizado', cedula: 'V-100', phone: '111', debt: 999999 },
      { id: 'CLIENT-DEBT-NEW', name: 'Cliente nuevo', cedula: 'V-101', debt: 5000 },
    ],
  });
  assert.equal(result.records[0].debt, 125.5);
  assert.equal(result.records[1].debt, 0);

  const existing = await posStore.getRecord('clientes', 'CLIENT-DEBT-PROTECTED', { id: 'cashier-debt-test', rol: 'cajero' });
  const created = await posStore.getRecord('clientes', 'CLIENT-DEBT-NEW', { id: 'cashier-debt-test', rol: 'cajero' });
  assert.equal(existing.debt, 125.5);
  assert.equal(existing.name, 'Cliente actualizado');
  assert.equal(created.debt, 0);
});


test('la sincronización genérica no elimina clientes ni deja CxC huérfanas', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T12:30:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CLIENT-DELETE-GUARD', JSON.stringify({ id: 'CLIENT-DELETE-GUARD', name: 'Cliente protegido', cedula: 'V-200', debt: 25 }), at],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxc(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CXC-DELETE-GUARD', JSON.stringify({ id: 'CXC-DELETE-GUARD', cliente: 'Cliente protegido [V-200]', montoUSD: 25, saldoUSD: 25, estado: 'pendiente' }), at],
    wantRows: false,
  });

  await assert.rejects(
    posStore.syncRecords({ table: 'clientes', records: [], deletedIds: ['CLIENT-DELETE-GUARD'] }),
    /operación transaccional de eliminación/,
  );
  assert.ok(await posStore.getRecord('clientes', 'CLIENT-DELETE-GUARD', { id: 'admin-delete-test', rol: 'administrador' }));
  assert.ok(await posStore.getRecord('cxc', 'CXC-DELETE-GUARD', { id: 'admin-delete-test', rol: 'administrador' }));
});


test('un lote genérico de clientes inválido revierte todas sus modificaciones', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T13:00:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CLIENT-BATCH-ROLLBACK', JSON.stringify({ id: 'CLIENT-BATCH-ROLLBACK', name: 'Nombre original', cedula: 'V-300', debt: 10 }), at],
    wantRows: false,
  });
  await assert.rejects(
    posStore.syncRecords({
      table: 'clientes',
      records: [
        { id: 'CLIENT-BATCH-ROLLBACK', name: 'Cambio que debe revertirse', cedula: 'V-300', debt: 0 },
        { name: 'Registro sin ID', cedula: 'V-301' },
      ],
    }),
    /no tiene identificador/,
  );
  const unchanged = await posStore.getRecord('clientes', 'CLIENT-BATCH-ROLLBACK', { id: 'admin-batch-test', rol: 'administrador' });
  assert.equal(unchanged.name, 'Nombre original');
  assert.equal(unchanged.debt, 10);
});


test('crear una deuda CxC nueva deriva el saldo del monto real y no del resumen enviado', async () => {
  await schema.ensureSqliteSchema();
  const result = await posStore.createCustomerDebtTransaction({
    operationId: 'CXC-CUSTOMER-DEBT-CANONICAL',
    debt: {
      id: 'CXC-CUSTOMER-DEBT-CANONICAL',
      cliente: 'Cliente Nuevo Canonico [V-600]',
      montoUSD: 40,
      abonadoUSD: 0,
      saldoUSD: 40,
      estado: 'pendiente',
      fecha: '2026-11-19T13:10:00.000Z',
      historialPagos: [],
    },
    customer: {
      id: 'CLIENT-CUSTOMER-DEBT-CANONICAL',
      name: 'Cliente Nuevo Canonico',
      cedula: 'V-600',
      debt: 999999,
    },
  });
  assert.equal(result.customer.debt, 40);
  const saved = await posStore.getRecord('clientes', 'CLIENT-CUSTOMER-DEBT-CANONICAL', { id: 'admin-cxc-test', rol: 'administrador' });
  assert.equal(saved.debt, 40);
});


test('reversar un abono CxC restaura también el saldo resumen del cliente y es idempotente', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T13:20:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CLIENT-REVERSE-CXC', JSON.stringify({
      id: 'CLIENT-REVERSE-CXC', name: 'Cliente Reversión', cedula: 'V-700', debt: 50,
    }), at],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxc(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CXC-REVERSE-CXC', JSON.stringify({
      id: 'CXC-REVERSE-CXC', cliente: 'Cliente Reversión [V-700]',
      montoUSD: 100, abonadoUSD: 50, saldoUSD: 50, estado: 'parcial',
      historialPagos: [{ id: 'PAYMENT-REVERSE-CXC', montoUSD: 50, montoBS: 2500 }],
    }), at],
    wantRows: false,
  });

  const first = await posStore.reverseDebtPaymentTransaction({
    operationId: 'REVERSE-CXC-ATOMIC-001',
    collection: 'cxc',
    debtId: 'CXC-REVERSE-CXC',
    paymentId: 'PAYMENT-REVERSE-CXC',
  });
  assert.equal(first.saldoUSD, 100);
  assert.equal(first.customer.debt, 100);

  const retry = await posStore.reverseDebtPaymentTransaction({
    operationId: 'REVERSE-CXC-ATOMIC-001',
    collection: 'cxc',
    debtId: 'CXC-REVERSE-CXC',
    paymentId: 'PAYMENT-REVERSE-CXC',
  });
  assert.equal(retry.recovered, true);
  assert.equal(retry.customer.debt, 100);
  const savedCustomer = await posStore.getRecord('clientes', 'CLIENT-REVERSE-CXC', { id: 'admin-cxc-test', rol: 'administrador' });
  assert.equal(savedCustomer.debt, 100);
});


test('reversar un abono CxP no modifica saldos de clientes', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T13:30:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CLIENT-UNCHANGED-CXP', JSON.stringify({ id: 'CLIENT-UNCHANGED-CXP', name: 'Cliente ajeno', cedula: 'V-800', debt: 17 }), at],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxp(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CXP-REVERSE-CXP', JSON.stringify({
      id: 'CXP-REVERSE-CXP', proveedor: 'Proveedor Prueba',
      montoUSD: 80, abonadoUSD: 30, saldoUSD: 50, estado: 'parcial',
      historialPagos: [{ id: 'PAYMENT-REVERSE-CXP', montoUSD: 30, montoBS: 0 }],
    }), at],
    wantRows: false,
  });
  const result = await posStore.reverseDebtPaymentTransaction({
    operationId: 'REVERSE-CXP-ATOMIC-001',
    collection: 'cxp',
    debtId: 'CXP-REVERSE-CXP',
    paymentId: 'PAYMENT-REVERSE-CXP',
  });
  assert.equal(result.saldoUSD, 80);
  assert.equal(result.customer, null);
  const customer = await posStore.getRecord('clientes', 'CLIENT-UNCHANGED-CXP', { id: 'admin-cxp-test', rol: 'administrador' });
  assert.equal(customer.debt, 17);
});


test('reversar un pago CxP subcentavo conserva precisión de seis decimales', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T13:40:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxp(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CXP-SUBCENT-REVERSE', JSON.stringify({
      id: 'CXP-SUBCENT-REVERSE', proveedor: 'Proveedor Subcentavo',
      montoUSD: 0.001, abonadoUSD: 0.0006, saldoUSD: 0.0004, estado: 'parcial',
      historialPagos: [{
        id: 'PAYMENT-SUBCENT-REVERSE', montoUSD: 0.0006, montoBS: 0.05,
        metodo: 'efectivo_bs', tasaAplicada: 83.333333,
      }],
    }), at],
    wantRows: false,
  });
  const result = await posStore.reverseDebtPaymentTransaction({
    operationId: 'REVERSE-CXP-SUBCENT-001',
    collection: 'cxp',
    debtId: 'CXP-SUBCENT-REVERSE',
    paymentId: 'PAYMENT-SUBCENT-REVERSE',
  });
  assert.equal(result.abonadoUSD, 0);
  assert.equal(result.saldoUSD, 0.001);
  assert.equal(result.estado, 'pendiente');
});


test('la restauración recupera catálogos personalizados y rechaza IDs duplicados antes de borrar datos', async () => {
  await schema.ensureSqliteSchema();
  const adminResult = await sqliteExecute({
    sql: "SELECT id FROM users WHERE rol='administrador' AND acceso_bloqueado=0 ORDER BY is_seed_admin DESC LIMIT 1",
  });
  assert.ok(adminResult.rows[0], 'la prueba requiere un administrador activo');
  const user = { id: String(adminResult.rows[0].id), rol: 'administrador' };

  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)',
    args: ['BACKUP-RESTORE-PRESERVE', JSON.stringify({ id: 'BACKUP-RESTORE-PRESERVE', nombre: 'No borrar en validación', stock: 9 })],
    wantRows: false,
  });

  const emptyTables = {
    movimientos: [], ventas: [], cxc: [], cxp: [], clientes: [], proveedores: [],
    devoluciones: [], anulaciones: [], terminales: [], libroDiario: [],
    reportesZ: [], compras: [], cashHistory: [],
  };
  const catalogNames = [
    'categorias','departamentos','categoriasPorDepartamento','marcas','presentaciones',
    'productCategories','productUnits','productColors','productSizes',
    'brands','groups','subgroups','lines','suppliers','departamentosPersonalizados',
  ];
  const catalogs = Object.fromEntries(catalogNames.map(name => [name, name === 'departamentosPersonalizados' ? ['Área exclusiva del negocio'] : []]));
  const catalogCounts = Object.fromEntries(catalogNames.map(name => [name, catalogs[name].length]));
  const baseData = {
    ...emptyTables,
    productos: [],
    users: [],
    config: {},
    ...catalogs,
  };

  const duplicateBackup = {
    app: 'posven-pro', version: 3,
    data: {
      ...baseData,
      productos: [
        { id: 'DUPLICATE-PRODUCT', nombre: 'Primero', stock: 1 },
        { id: 'DUPLICATE-PRODUCT', nombre: 'Segundo', stock: 2 },
      ],
    },
    meta: { source: 'sqlite-local', complete: true, catalogs: catalogCounts },
  };
  await assert.rejects(
    posStore.restoreBackupTransaction({ user, backup: duplicateBackup }),
    /identificadores duplicados/,
  );
  const preserved = await posStore.getRecord('productos', 'BACKUP-RESTORE-PRESERVE', user);
  assert.equal(preserved.stock, 9, 'un respaldo inválido no debe borrar ni alterar SQLite');

  const validBackup = {
    app: 'posven-pro', version: 3,
    data: {
      ...baseData,
      productos: [{ id: 'RESTORED-PRODUCT', nombre: 'Producto restaurado', stock: 4 }],
    },
    meta: {
      source: 'sqlite-local', complete: true,
      sqliteTables: { productos: 1, movimientos: 0, ventas: 0, cxc: 0, cxp: 0, clientes: 0, proveedores: 0, devoluciones: 0, anulaciones: 0, terminales: 0, libroDiario: 0, reportesZ: 0, caja: 0, compras: 0, users: 0 },
      catalogs: catalogCounts,
    },
  };
  const restored = await posStore.restoreBackupTransaction({ user, backup: validBackup });
  assert.equal(restored.counts['catalogo:departamentosPersonalizados'], 1);
  const customCatalog = await sqliteExecute({
    sql: "SELECT lista_json FROM catalogos WHERE nombre='departamentosPersonalizados'",
  });
  assert.deepEqual(JSON.parse(customCatalog.rows[0].lista_json), ['Área exclusiva del negocio']);
  const product = await posStore.getRecord('productos', 'RESTORED-PRODUCT', user);
  assert.equal(product.stock, 4);
});
