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
    ['READ-CXC-A', 'READ-CXC-GLOBAL'],
  );
  assert.equal(await posStore.getRecord('cxc', 'READ-CXC-B', cashier), null);
  assert.equal(await posStore.countRecords('cxc', cashier), 2);
  assert.deepEqual(
    (await posStore.listRecords('terminales', { limit: 100 }, cashier)).map(row => row.id),
    ['READ-CAJA-A'],
  );
  assert.equal(await posStore.countRecords('cxp', cashier), 0);
  assert.equal(await posStore.getRecord('cxp', 'READ-CXP-ADMIN', cashier), null);
  assert.ok(await posStore.getRecord('ventas', 'READ-SALE-B', { id: 'read-admin', rol: 'administrador' }));
  assert.ok(await posStore.countRecords('ventas', { id: 'read-admin', rol: 'administrador' }) >= 2);
});


test('un cajero no puede cobrar una CxC originada por ventas de otra terminal', async () => {
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

  await assert.rejects(
    posStore.applyDebtPaymentTransaction({
      operationId: 'SCOPE-ATTACK-FOREIGN-CXC', collection: 'cxc', debtId: foreignDebt.id,
      amountUSD: 1, amountBS: 1, payment: { id: 'SCOPE-PAY-FOREIGN', montoUSD: 1, montoBS: 1, fecha: at, metodo: 'efectivo' },
      terminalId: terminal.id, user: cashier,
    }),
    /propia terminal/,
  );
  const unchangedForeignDebt = await posStore.getRecord('cxc', foreignDebt.id);
  assert.equal(unchangedForeignDebt.saldoUSD, 20);
  assert.equal((unchangedForeignDebt.historialPagos || []).length, 0);

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
