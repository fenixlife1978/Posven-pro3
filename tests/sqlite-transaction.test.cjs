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
  assert.equal(saleResult.sale.items[0].costoUnitarioUSD, 2, 'el costo del kit debe sumar dos componentes a USD 1 cada uno');
  let parent = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: ['KIT-PACK'] });
  let component = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: ['KIT-COMP'] });
  assert.equal(JSON.parse(parent.rows[0].data_json).stock, 5);
  assert.equal(JSON.parse(component.rows[0].data_json).stock, 6);

  // Simula que el CPP cambió después de la venta; la devolución debe
  // reingresar los componentes al costo original y recalcular el promedio.
  await sqliteExecute({
    sql: "UPDATE productos SET data_json=json_set(data_json,'$.costoUSD',3) WHERE id=?",
    args: ['KIT-COMP'],
    wantRows: false,
  });
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
  assert.equal(JSON.parse(component.rows[0].data_json).costoUSD, 2.5, 'el CPP debe ponderar 6 unidades a USD 3 y 2 devueltas a USD 1');
  const returnMovement = await sqliteExecute({
    sql: "SELECT data_json FROM movimientos WHERE json_extract(data_json,'$.tipo')='devolucion' AND json_extract(data_json,'$.productoId')='KIT-COMP'",
  });
  assert.equal(JSON.parse(returnMovement.rows[0].data_json).costoUnitarioUSD, 1);
  assert.equal(JSON.parse(returnMovement.rows[0].data_json).tasaBCV, 1);

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
  assert.equal(JSON.parse(component.rows[0].data_json).costoUSD, 2.2, 'la anulación debe reponer las unidades pendientes al costo original y recalcular CPP');
  const cancellationMovement = await sqliteExecute({
    sql: "SELECT data_json FROM movimientos WHERE json_extract(data_json,'$.tipo')='anulacion' AND json_extract(data_json,'$.productoId')='KIT-COMP'",
  });
  assert.equal(JSON.parse(cancellationMovement.rows[0].data_json).costoUnitarioUSD, 1);
  assert.equal(JSON.parse(cancellationMovement.rows[0].data_json).tasaBCV, 1);

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

  await assert.rejects(
    posStore.processReturnOrCancellationTransaction({
      operationId: 'KIT-RETURN-AFTER-CANCEL',
      operationType: 'DEVOLUCION',
      saleId: saleResult.sale.id,
      operationDoc: { id: 'DEV-AFTER-CANCEL', fecha: '2026-11-14T11:30:00.000Z', items: [returnedItem] },
      movements: [],
      refundItems: [returnedItem],
      terminalId: 'KITBOX',
      user,
    }),
    /ya fue anulada/i,
  );
  component = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: ['KIT-COMP'] });
  assert.equal(JSON.parse(component.rows[0].data_json).stock, 10);
});


test('devoluciones limitan reintegros al dinero cobrado y excluyen notas de crédito de caja', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T18:00:00.000Z';
  const terminal = {
    id: 'REFUND-BOX', nombre: 'Caja Reembolsos', prefijoCaja: 'REFUND',
    isCashOpen: true, cashData: { openDate: at, openedBy: 'Prueba' },
    proximaDevolucion: 1, proximaAnulacion: 1, cashHistory: [],
  };
  const product = { id: 'REFUND-PRODUCT', nombre: 'Producto devolución', stock: 0, costoUSD: 2 };
  const sale = {
    id: 'REFUND-SALE', fecha: at, estado: 'completada', terminalId: terminal.id,
    totalUSD: 20, metodoPago: 'mixto', type: 'VENTA',
    items: [{ productoId: product.id, nombre: product.nombre, cantidad: 2, precioUnitUSD: 10, subtotalUSD: 20 }],
    payments: [
      { metodo: 'efectivo_usd', montoUSD: 6, montoBS: 0 },
      { metodo: 'credito', montoUSD: 14, montoBS: 0 },
    ],
  };
  const debt = { id: 'REFUND-DEBT', ventaId: sale.id, montoUSD: 14, saldoUSD: 14, abonadoUSD: 0, estado: 'parcial' };
  for (const [table, row] of [['terminales', terminal], ['productos', product], ['ventas', sale], ['cxc', debt]]) {
    await sqliteExecute({
      sql: table === 'productos'
        ? 'INSERT INTO productos(id,data_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)'
        : `INSERT INTO ${table}(id,data_json,fecha) VALUES(?,?,?)`,
      args: table === 'productos' ? [row.id, JSON.stringify(row)] : [row.id, JSON.stringify(row), at],
      wantRows: false,
    });
  }
  const user = { id: 'refund-admin', rol: 'administrador', nombre: 'Prueba' };
  const firstItem = { productoId: product.id, nombre: product.nombre, cantidad: 1, precioUnitUSD: 10, subtotalUSD: 10, estadoProducto: 'REINTEGRADO_STOCK' };

  await assert.rejects(
    posStore.processReturnOrCancellationTransaction({
      operationId: 'REFUND-OVERPAID',
      operationType: 'DEVOLUCION',
      saleId: sale.id,
      operationDoc: { id: 'DEV-OVERPAID', fecha: at, items: [firstItem], refundPayments: [
        { metodo: 'efectivo_usd', montoUSD: 7, montoBS: 0 },
        { metodo: 'nota_credito', montoUSD: 3, montoBS: 0 },
      ] },
      refundItems: [firstItem], movements: [], terminalId: terminal.id, user,
    }),
    /supera lo realmente cobrado/i,
  );

  const failedProduct = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: [product.id] });
  assert.equal(JSON.parse(failedProduct.rows[0].data_json).stock, 0);
  assert.equal(Number((await sqliteExecute({ sql: 'SELECT COUNT(*) AS n FROM devoluciones WHERE id=?', args: ['DEV-OVERPAID'] })).rows[0].n), 0);

  const first = await posStore.processReturnOrCancellationTransaction({
    operationId: 'REFUND-VALID',
    operationType: 'DEVOLUCION',
    saleId: sale.id,
    operationDoc: { id: 'DEV-VALID', fecha: at, items: [firstItem], refundPayments: [
      { metodo: 'efectivo_usd', montoUSD: 6, montoBS: 0 },
      { metodo: 'nota_credito', montoUSD: 4, montoBS: 0 },
    ] },
    journal: { id: 'REFUND-JOURNAL', tipo: 'egreso', categoria: 'DEVOLUCION', montoUSD: 10, referencia: 'DEV-VALID' },
    refundItems: [firstItem], movements: [], terminalId: terminal.id, user,
  });
  assert.equal(first.journal.montoUSD, 6);
  assert.equal(first.debt.saldoUSD, 4);
  assert.equal(first.operationDoc.refundPayments.length, 2);
  const legacyReturnMovement = await sqliteExecute({
    sql: "SELECT data_json FROM movimientos WHERE json_extract(data_json,'$.tipo')='devolucion' AND json_extract(data_json,'$.productoId')=?",
    args: [product.id],
  });
  assert.equal(JSON.parse(legacyReturnMovement.rows[0].data_json).costoHistoricoPendiente, true, 'un registro legado sin costo no debe heredar el CPP actual como si fuera histórico');
  const productAfterLegacyReturn = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: [product.id] });
  assert.equal(JSON.parse(productAfterLegacyReturn.rows[0].data_json).costoUSD, 2);

  const secondItem = { ...firstItem, cantidad: 1 };
  await assert.rejects(
    posStore.processReturnOrCancellationTransaction({
      operationId: 'REFUND-SECOND-CASH',
      operationType: 'DEVOLUCION',
      saleId: sale.id,
      operationDoc: { id: 'DEV-SECOND-CASH', fecha: '2026-11-19T18:30:00.000Z', items: [secondItem], refundPayments: [
        { metodo: 'efectivo_usd', montoUSD: 1, montoBS: 0 },
        { metodo: 'nota_credito', montoUSD: 9, montoBS: 0 },
      ] },
      refundItems: [secondItem], movements: [], terminalId: terminal.id, user,
    }),
    /descontando reintegros anteriores/i,
  );
  const finalProduct = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: [product.id] });
  assert.equal(JSON.parse(finalProduct.rows[0].data_json).stock, 1);
  assert.equal((await posStore.getRecord('cxc', debt.id, user)).saldoUSD, 4);
  const journalRows = await sqliteExecute({ sql: 'SELECT data_json FROM libro_diario WHERE id=?', args: ['REFUND-JOURNAL'] });
  assert.equal(JSON.parse(journalRows.rows[0].data_json).montoUSD, 6);
  // Esta deuda es un fixture de la prueba; no debe contaminar la prueba
  // posterior que verifica el alcance global de la cartera CxC.
  await sqliteExecute({ sql: 'DELETE FROM cxc WHERE id=?', args: [debt.id], wantRows: false });
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


test('el abono individual CxC conserva el total Bs real de pagos mixtos', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T14:00:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CLIENT-MIXED-CXC', JSON.stringify({
      id: 'CLIENT-MIXED-CXC', name: 'Cliente Pago Mixto', cedula: 'V-900', debt: 100,
    }), at],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxc(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CXC-MIXED-CURRENCY', JSON.stringify({
      id: 'CXC-MIXED-CURRENCY', cliente: 'Cliente Pago Mixto [V-900]',
      montoUSD: 100, abonadoUSD: 0, saldoUSD: 100, estado: 'pendiente',
      historialPagos: [],
    }), at],
    wantRows: false,
  });

  const result = await posStore.applyDebtPaymentTransaction({
    operationId: 'CXC-MIXED-CURRENCY-001',
    collection: 'cxc',
    debtId: 'CXC-MIXED-CURRENCY',
    amountUSD: 10,
    // El pago incluye USD y Bs: Bs reales recibidos, no la conversión del total USD.
    amountBS: 3000,
    payment: {
      fecha: at, montoUSD: 10, montoBS: 8740, tasaAplicada: 874,
      metodo: 'mixto', reciboId: 'PEND-CXC-MIXED',
    },
    user: { id: 'admin-cxc-mixed', rol: 'administrador' },
  });

  assert.equal(result.appliedUSD, 10);
  assert.equal(result.appliedBS, 3000);
  assert.equal(result.payment.montoBS, 3000);
  const saved = await posStore.getRecord('cxc', 'CXC-MIXED-CURRENCY', { id: 'admin-cxc-mixed', rol: 'administrador' });
  assert.equal(saved.historialPagos[0].montoBS, 3000);
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


test('reversar un abono CxC rechaza homónimos y revierte toda la operación', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T13:25:00.000Z';
  for (const [id, cedula] of [['CLIENT-HOMONYM-1', 'V-701'], ['CLIENT-HOMONYM-2', 'V-702']]) {
    await sqliteExecute({
      sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
      args: [id, JSON.stringify({ id, name: 'Cliente Homónimo', cedula, debt: 25 }), at],
      wantRows: false,
    });
  }
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxc(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CXC-REVERSE-HOMONYM', JSON.stringify({
      id: 'CXC-REVERSE-HOMONYM', cliente: 'Cliente Homónimo',
      montoUSD: 50, abonadoUSD: 25, saldoUSD: 25, estado: 'parcial',
      historialPagos: [{ id: 'PAYMENT-REVERSE-HOMONYM', montoUSD: 25, montoBS: 0 }],
    }), at],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO libro_diario(id,data_json,fecha) VALUES(?,?,?)',
    args: ['JOURNAL-REVERSE-HOMONYM', JSON.stringify({
      id: 'JOURNAL-REVERSE-HOMONYM', montoUSD: 25, montoBS: 0, concepto: 'Abono CxC',
    }), at],
    wantRows: false,
  });

  await assert.rejects(
    posStore.reverseDebtPaymentTransaction({
      operationId: 'REVERSE-CXC-HOMONYM-001',
      collection: 'cxc',
      debtId: 'CXC-REVERSE-HOMONYM',
      paymentId: 'PAYMENT-REVERSE-HOMONYM',
      journalId: 'JOURNAL-REVERSE-HOMONYM',
    }),
    /homónimos/,
  );

  const debt = await posStore.getRecord('cxc', 'CXC-REVERSE-HOMONYM', { id: 'admin-cxc-homonym', rol: 'administrador' });
  const first = await posStore.getRecord('clientes', 'CLIENT-HOMONYM-1', { id: 'admin-cxc-homonym', rol: 'administrador' });
  const second = await posStore.getRecord('clientes', 'CLIENT-HOMONYM-2', { id: 'admin-cxc-homonym', rol: 'administrador' });
  const journal = await posStore.getRecord('libroDiario', 'JOURNAL-REVERSE-HOMONYM', { id: 'admin-cxc-homonym', rol: 'administrador' });
  assert.equal(debt.saldoUSD, 25);
  assert.equal(debt.historialPagos.length, 1);
  assert.equal(first.debt, 25);
  assert.equal(second.debt, 25);
  assert.equal(journal.montoUSD, 25);
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

  const duplicateUsersBackup = {
    app: 'posven-pro', version: 3,
    data: {
      ...baseData,
      productos: [{ id: 'RESTORE-ROLLBACK-PRODUCT', nombre: 'No debe quedar', stock: 1 }],
      users: [
        { id: 'restore-user-one', username: 'duplicate-import-user', nombre: 'Uno', rol: 'cajero' },
        { id: 'restore-user-two', username: 'duplicate-import-user', nombre: 'Dos', rol: 'cajero' },
      ],
    },
    meta: {
      source: 'sqlite-local', complete: true,
      sqliteTables: { productos: 1, users: 2 },
      catalogs: catalogCounts,
    },
  };
  await assert.rejects(
    posStore.restoreBackupTransaction({ user, backup: duplicateUsersBackup }),
  );
  const afterRollback = await posStore.getRecord('productos', 'BACKUP-RESTORE-PRESERVE', user);
  assert.equal(afterRollback.stock, 9, 'un fallo SQL dentro de la restauración debe revertir el borrado y las inserciones');

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


test('un cobro global CxC actualiza el saldo del cliente cuando la deuda histórica solo tiene nombre', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T14:10:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CLIENT-GLOBAL-CXC-NAME', JSON.stringify({
      id: 'CLIENT-GLOBAL-CXC-NAME', name: 'Cliente Cobro por Nombre',
      cedula: 'V-910', debt: 80,
    }), at],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxc(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CXC-GLOBAL-NAME-ONLY', JSON.stringify({
      id: 'CXC-GLOBAL-NAME-ONLY', cliente: 'Cliente Cobro por Nombre',
      montoUSD: 80, abonadoUSD: 0, saldoUSD: 80, estado: 'pendiente',
      fecha: at, historialPagos: [],
    }), at],
    wantRows: false,
  });

  const result = await posStore.applyGlobalCustomerPaymentTransaction({
    operationId: 'GLOBAL-CXC-NAME-ONLY-001',
    customerName: 'Cliente Cobro por Nombre',
    amountUSD: 20,
    amountBS: 7400,
    payment: { id: 'PAY-GLOBAL-CXC-NAME-ONLY', fecha: at, metodo: 'efectivo_usd', tasaAplicada: 370 },
  });
  assert.equal(result.appliedUSD, 20);
  const customer = await posStore.getRecord('clientes', 'CLIENT-GLOBAL-CXC-NAME', { id: 'admin-global-cxc-test', rol: 'administrador' });
  assert.equal(customer.debt, 60);
  const debt = await posStore.getRecord('cxc', 'CXC-GLOBAL-NAME-ONLY', { id: 'admin-global-cxc-test', rol: 'administrador' });
  assert.equal(debt.saldoUSD, 60);
});


test('un cobro global CxC con clientes homónimos se revierte sin modificar saldos', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T14:20:00.000Z';
  for (const id of ['CLIENT-GLOBAL-DUP-1', 'CLIENT-GLOBAL-DUP-2']) {
    await sqliteExecute({
      sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
      args: [id, JSON.stringify({ id, name: 'Cliente Homónimo', debt: 50 }), at],
      wantRows: false,
    });
  }
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxc(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CXC-GLOBAL-DUP-NAME', JSON.stringify({
      id: 'CXC-GLOBAL-DUP-NAME', cliente: 'Cliente Homónimo',
      montoUSD: 50, abonadoUSD: 0, saldoUSD: 50, estado: 'pendiente',
      fecha: at, historialPagos: [],
    }), at],
    wantRows: false,
  });

  await assert.rejects(
    posStore.applyGlobalCustomerPaymentTransaction({
      operationId: 'GLOBAL-CXC-DUP-NAME-001',
      customerName: 'Cliente Homónimo',
      amountUSD: 10,
      amountBS: 3700,
      payment: { id: 'PAY-GLOBAL-CXC-DUP-NAME', fecha: at, metodo: 'efectivo_usd', tasaAplicada: 370 },
    }),
    /más de un cliente/,
  );
  const debt = await posStore.getRecord('cxc', 'CXC-GLOBAL-DUP-NAME', { id: 'admin-global-cxc-test', rol: 'administrador' });
  assert.equal(debt.saldoUSD, 50);
  for (const id of ['CLIENT-GLOBAL-DUP-1', 'CLIENT-GLOBAL-DUP-2']) {
    const customer = await posStore.getRecord('clientes', id, { id: 'admin-global-cxc-test', rol: 'administrador' });
    assert.equal(customer.debt, 50);
  }
});


test('registrar compra devuelve productos actualizados y calcula costo ponderado de líneas repetidas', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T14:40:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: ['PURCHASE-WEIGHTED-PRODUCT', JSON.stringify({
      id: 'PURCHASE-WEIGHTED-PRODUCT', nombre: 'Producto Compra Ponderada',
      stock: 5, costoUSD: 8,
    }), at],
    wantRows: false,
  });
  const purchase = {
    id: 'PURCHASE-WEIGHTED-001', fecha: '2026-11-19', fechaHora: at,
    proveedor: 'Proveedor Ponderado', numeroFactura: 'FAC-POND-001',
    montoUSD: 35, pagadoUSD: 35, saldoUSD: 0, items: [],
  };
  const params = {
    operationId: 'PURCHASE-WEIGHTED-OP-001',
    purchase,
    items: [
      { productoId: 'PURCHASE-WEIGHTED-PRODUCT', nombre: 'Producto Compra Ponderada', cantidad: 2, costoUnitarioUSD: 10, subtotalUSD: 20 },
      { productoId: 'PURCHASE-WEIGHTED-PRODUCT', nombre: 'Producto Compra Ponderada', cantidad: 1, costoUnitarioUSD: 15, subtotalUSD: 15 },
    ],
    purchaseDate: '2026-11-19',
    purchaseDateTime: at,
    supplier: 'Proveedor Ponderado',
    invoiceNumber: 'FAC-POND-001',
    exchangeRate: 370,
  };
  const result = await posStore.createPurchaseTransaction(params);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].stock, 8);
  assert.equal(result.products[0].costoUSD, 9.375);
  const savedProduct = await posStore.getRecord('productos', 'PURCHASE-WEIGHTED-PRODUCT', { id: 'admin-purchase-test', rol: 'administrador' });
  assert.equal(savedProduct.stock, 8);
  const movementRows = await sqliteExecute({
    sql: "SELECT id,data_json FROM movimientos WHERE json_extract(data_json,'$.referencia')=?",
    args: ['COMPRA FACT: FAC-POND-001 - PROV: Proveedor Ponderado'],
  });
  assert.equal(movementRows.rows.length, 1);
  const movement = JSON.parse(movementRows.rows[0].data_json);
  assert.equal(movement.cantidad, 3);
  assert.equal(movement.costoUnitarioUSD, 35 / 3);

  const retry = await posStore.createPurchaseTransaction(params);
  assert.equal(retry.recovered, true);
  assert.equal(retry.products.length, 1);
  assert.equal(retry.products[0].stock, 8);
});


test('eliminar la primera compra reconstruye el Kardex desde el saldo anterior al primer movimiento', async () => {
  await schema.ensureSqliteSchema();
  const baseAt = '2026-11-19T10:00:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: ['PURCHASE-DELETE-BASE', JSON.stringify({
      id: 'PURCHASE-DELETE-BASE', nombre: 'Producto Base Compra', stock: 5, costoUSD: 8,
    }), baseAt],
    wantRows: false,
  });
  const first = {
    operationId: 'PURCHASE-DELETE-FIRST-OP',
    purchase: {
      id: 'PURCHASE-DELETE-FIRST', fecha: '2026-11-19', fechaHora: baseAt,
      proveedor: 'Proveedor Kardex', numeroFactura: 'FAC-DELETE-FIRST',
      montoUSD: 30, items: [{ productoId: 'PURCHASE-DELETE-BASE', cantidad: 3, costoUnitarioUSD: 10 }],
    },
    items: [{ productoId: 'PURCHASE-DELETE-BASE', cantidad: 3, costoUnitarioUSD: 10, subtotalUSD: 30 }],
    purchaseDate: '2026-11-19', purchaseDateTime: baseAt,
    supplier: 'Proveedor Kardex', invoiceNumber: 'FAC-DELETE-FIRST', exchangeRate: 370,
  };
  await posStore.createPurchaseTransaction(first);
  const secondAt = '2026-11-19T11:00:00.000Z';
  await posStore.createPurchaseTransaction({
    operationId: 'PURCHASE-DELETE-SECOND-OP',
    purchase: {
      id: 'PURCHASE-DELETE-SECOND', fecha: '2026-11-19', fechaHora: secondAt,
      proveedor: 'Proveedor Kardex', numeroFactura: 'FAC-DELETE-SECOND',
      montoUSD: 24, items: [{ productoId: 'PURCHASE-DELETE-BASE', cantidad: 2, costoUnitarioUSD: 12 }],
    },
    items: [{ productoId: 'PURCHASE-DELETE-BASE', cantidad: 2, costoUnitarioUSD: 12, subtotalUSD: 24 }],
    purchaseDate: '2026-11-19', purchaseDateTime: secondAt,
    supplier: 'Proveedor Kardex', invoiceNumber: 'FAC-DELETE-SECOND', exchangeRate: 370,
  });

  const before = await posStore.getRecord('productos', 'PURCHASE-DELETE-BASE', { id: 'admin-purchase-delete-test', rol: 'administrador' });
  assert.equal(before.stock, 10);
  assert.equal(before.costoUSD, 9.4);

  const deleted = await posStore.deletePurchaseTransaction({
    operationId: 'PURCHASE-DELETE-FIRST-OPERATION',
    purchaseId: 'PURCHASE-DELETE-FIRST',
    invoiceNumber: 'FAC-DELETE-FIRST',
    supplier: 'Proveedor Kardex',
    purchaseDate: '2026-11-19',
  });
  assert.equal(deleted.deletedPurchase, 1);
  const after = await posStore.getRecord('productos', 'PURCHASE-DELETE-BASE', { id: 'admin-purchase-delete-test', rol: 'administrador' });
  assert.equal(after.stock, 7);
  assert.equal(after.costoUSD, Math.round((64 / 7 + Number.EPSILON) * 1000000) / 1000000);
  const remaining = await sqliteExecute({
    sql: "SELECT id,data_json FROM movimientos WHERE json_extract(data_json,'$.productoId')=? ORDER BY fecha ASC,id ASC",
    args: ['PURCHASE-DELETE-BASE'],
  });
  assert.equal(remaining.rows.length, 1);
  const movement = JSON.parse(remaining.rows[0].data_json);
  assert.equal(movement.stockAntes, 5);
  assert.equal(movement.stockDespues, 7);
});

test('no permite borrar una compra si hay salidas posteriores que exigen recalcular el costo histórico', async () => {
  await schema.ensureSqliteSchema();
  const purchaseAt = '2026-11-19T12:00:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: ['PURCHASE-DELETE-SALE-PRODUCT', JSON.stringify({
      id: 'PURCHASE-DELETE-SALE-PRODUCT', nombre: 'Producto con Venta Posterior', stock: 5, costoUSD: 8,
    }), purchaseAt],
    wantRows: false,
  });
  await posStore.createPurchaseTransaction({
    operationId: 'PURCHASE-DELETE-SALE-OP',
    purchase: {
      id: 'PURCHASE-DELETE-SALE', fecha: '2026-11-19', fechaHora: purchaseAt,
      proveedor: 'Proveedor con Venta', numeroFactura: 'FAC-DELETE-SALE',
      montoUSD: 30, items: [{ productoId: 'PURCHASE-DELETE-SALE-PRODUCT', cantidad: 3, costoUnitarioUSD: 10 }],
    },
    items: [{ productoId: 'PURCHASE-DELETE-SALE-PRODUCT', cantidad: 3, costoUnitarioUSD: 10, subtotalUSD: 30 }],
    purchaseDate: '2026-11-19', purchaseDateTime: purchaseAt,
    supplier: 'Proveedor con Venta', invoiceNumber: 'FAC-DELETE-SALE', exchangeRate: 370,
  });
  const saleAt = '2026-11-19T13:00:00.000Z';
  await sqliteExecute({
    sql: 'INSERT INTO movimientos(id,data_json,fecha) VALUES(?,?,?)',
    args: ['PURCHASE-DELETE-SALE-MOV', JSON.stringify({
      id: 'PURCHASE-DELETE-SALE-MOV', productoId: 'PURCHASE-DELETE-SALE-PRODUCT',
      tipo: 'venta', cantidad: -2, stockAntes: 8, stockDespues: 6,
      costoUnitarioUSD: 8.75, fecha: saleAt, referencia: 'VENTA TEST',
    }), saleAt],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'UPDATE productos SET data_json=json_set(data_json,\'$.stock\',6) WHERE id=?',
    args: ['PURCHASE-DELETE-SALE-PRODUCT'],
    wantRows: false,
  });

  await assert.rejects(
    posStore.deletePurchaseTransaction({
      operationId: 'PURCHASE-DELETE-SALE-OPERATION',
      purchaseId: 'PURCHASE-DELETE-SALE',
      invoiceNumber: 'FAC-DELETE-SALE',
      supplier: 'Proveedor con Venta',
      purchaseDate: '2026-11-19',
    }),
    /movimientos posteriores de tipo venta/,
  );
  const product = await posStore.getRecord('productos', 'PURCHASE-DELETE-SALE-PRODUCT', { id: 'admin-purchase-delete-test', rol: 'administrador' });
  assert.equal(product.stock, 6);
  assert.equal(product.costoUSD, 8.75);
  const purchase = await posStore.getRecord('compras', 'PURCHASE-DELETE-SALE', { id: 'admin-purchase-delete-test', rol: 'administrador' });
  assert.ok(purchase, 'la compra debe permanecer intacta cuando la eliminación se rechaza');
  const saleMovement = await posStore.getRecord('movimientos', 'PURCHASE-DELETE-SALE-MOV', { id: 'admin-purchase-delete-test', rol: 'administrador' });
  assert.equal(saleMovement.cantidad, -2);
});

test('el id de compra no puede utilizarse para borrar una factura distinta', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T13:30:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO compras(id,data_json,fecha) VALUES(?,?,?)',
    args: ['PURCHASE-ID-MISMATCH', JSON.stringify({
      id: 'PURCHASE-ID-MISMATCH', numeroFactura: 'FAC-REAL', proveedor: 'Proveedor Real', fecha: '2026-11-19',
    }), '2026-11-19'],
    wantRows: false,
  });
  await assert.rejects(
    posStore.deletePurchaseTransaction({
      operationId: 'PURCHASE-ID-MISMATCH-DELETE',
      purchaseId: 'PURCHASE-ID-MISMATCH',
      invoiceNumber: 'FAC-FALSA',
      supplier: 'Proveedor Falso',
      purchaseDate: '2026-11-19',
    }),
    /no coincide con la factura, proveedor y fecha/,
  );
  const preserved = await posStore.getRecord('compras', 'PURCHASE-ID-MISMATCH', { id: 'admin-purchase-delete-test', rol: 'administrador' });
  assert.equal(preserved.numeroFactura, 'FAC-REAL');
});

test('una compra con cantidad negativa se rechaza antes de alterar inventario o historial', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T14:50:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: ['PURCHASE-INVALID-QUANTITY', JSON.stringify({
      id: 'PURCHASE-INVALID-QUANTITY', nombre: 'Producto Cantidad Inválida',
      stock: 3, costoUSD: 4,
    }), at],
    wantRows: false,
  });
  await assert.rejects(
    posStore.createPurchaseTransaction({
      operationId: 'PURCHASE-INVALID-OP-001',
      purchase: { id: 'PURCHASE-INVALID-001', fecha: '2026-11-19', proveedor: 'Proveedor', numeroFactura: 'FAC-INVALID-001' },
      items: [{ productoId: 'PURCHASE-INVALID-QUANTITY', cantidad: -2, costoUnitarioUSD: 4, subtotalUSD: -8 }],
      purchaseDate: '2026-11-19', purchaseDateTime: at,
      supplier: 'Proveedor', invoiceNumber: 'FAC-INVALID-001', exchangeRate: 370,
    }),
    /cantidad.*mayor que cero/,
  );
  const product = await posStore.getRecord('productos', 'PURCHASE-INVALID-QUANTITY', { id: 'admin-purchase-test', rol: 'administrador' });
  assert.equal(product.stock, 3);
  const purchases = await sqliteExecute({
    sql: "SELECT COUNT(*) AS total FROM compras WHERE id='PURCHASE-INVALID-001'",
  });
  assert.equal(Number(purchases.rows[0].total), 0);
});


test('un pago individual CxC actualiza el cliente por nombre y rechaza homónimos con rollback', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T15:00:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CLIENT-INDIVIDUAL-CXC-NAME', JSON.stringify({
      id: 'CLIENT-INDIVIDUAL-CXC-NAME', name: 'Cliente Pago Individual', debt: 30,
    }), at],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxc(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CXC-INDIVIDUAL-CXC-NAME', JSON.stringify({
      id: 'CXC-INDIVIDUAL-CXC-NAME', cliente: 'Cliente Pago Individual',
      montoUSD: 30, abonadoUSD: 0, saldoUSD: 30, estado: 'pendiente',
      historialPagos: [],
    }), at],
    wantRows: false,
  });
  const paid = await posStore.applyDebtPaymentTransaction({
    operationId: 'INDIVIDUAL-CXC-NAME-001',
    collection: 'cxc', debtId: 'CXC-INDIVIDUAL-CXC-NAME',
    amountUSD: 10, amountBS: 3700,
    payment: { id: 'PAY-INDIVIDUAL-CXC-NAME', fecha: at, metodo: 'efectivo_usd', tasaAplicada: 370 },
    user: { id: 'admin-individual-cxc', rol: 'administrador' },
  });
  assert.equal(paid.saldoUSD, 20);
  const customer = await posStore.getRecord('clientes', 'CLIENT-INDIVIDUAL-CXC-NAME', { id: 'admin-individual-cxc', rol: 'administrador' });
  assert.equal(customer.debt, 20);

  for (const id of ['CLIENT-INDIVIDUAL-DUP-1', 'CLIENT-INDIVIDUAL-DUP-2']) {
    await sqliteExecute({
      sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
      args: [id, JSON.stringify({ id, name: 'Cliente Individual Homónimo', debt: 25 }), at],
      wantRows: false,
    });
  }
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxc(id,data_json,fecha) VALUES(?,?,?)',
    args: ['CXC-INDIVIDUAL-DUP-NAME', JSON.stringify({
      id: 'CXC-INDIVIDUAL-DUP-NAME', cliente: 'Cliente Individual Homónimo',
      montoUSD: 25, abonadoUSD: 0, saldoUSD: 25, estado: 'pendiente',
      historialPagos: [],
    }), at],
    wantRows: false,
  });
  await assert.rejects(
    posStore.applyDebtPaymentTransaction({
      operationId: 'INDIVIDUAL-CXC-DUP-001',
      collection: 'cxc', debtId: 'CXC-INDIVIDUAL-DUP-NAME',
      amountUSD: 5, amountBS: 1850,
      payment: { id: 'PAY-INDIVIDUAL-CXC-DUP', fecha: at, metodo: 'efectivo_usd', tasaAplicada: 370 },
      user: { id: 'admin-individual-cxc', rol: 'administrador' },
    }),
    /más de un cliente/,
  );
  const unchangedDebt = await posStore.getRecord('cxc', 'CXC-INDIVIDUAL-DUP-NAME', { id: 'admin-individual-cxc', rol: 'administrador' });
  assert.equal(unchangedDebt.saldoUSD, 25);
  for (const id of ['CLIENT-INDIVIDUAL-DUP-1', 'CLIENT-INDIVIDUAL-DUP-2']) {
    const duplicate = await posStore.getRecord('clientes', id, { id: 'admin-individual-cxc', rol: 'administrador' });
    assert.equal(duplicate.debt, 25);
  }
});


test('un ajuste de inventario no puede dejar existencias negativas ni persistir cambios parciales', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T23:30:00.000Z';
  const productId = 'INV-NEGATIVE-STOCK-GUARD';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: [productId, JSON.stringify({ id: productId, nombre: 'Producto Stock Protegido', stock: 2, costoUSD: 4 }), at],
    wantRows: false,
  });

  await assert.rejects(
    posStore.applyInventoryMovementsTransaction({
      operationId: 'INV-NEGATIVE-STOCK-OP',
      operationType: 'AJUSTE_INVENTARIO',
      movements: [{
        id: 'INV-NEGATIVE-STOCK-MOV', productoId: productId, tipo: 'ajuste_salida',
        cantidad: -3, fecha: at, referencia: 'PRUEBA SALIDA MAYOR AL STOCK',
      }],
      productPatches: {},
    }),
    /stock negativo/i,
  );

  const product = await posStore.getRecord('productos', productId, { id: 'admin-inventory-test', rol: 'administrador' });
  assert.equal(product.stock, 2);
  const movements = await sqliteExecute({
    sql: 'SELECT COUNT(*) AS total FROM movimientos WHERE id=?',
    args: ['INV-NEGATIVE-STOCK-MOV'],
  });
  assert.equal(Number(movements.rows[0].total), 0);
  const operation = await sqliteExecute({
    sql: 'SELECT COUNT(*) AS total FROM operaciones WHERE prefijo=? AND operation_id=?',
    args: ['INVENTARIO', 'INV-NEGATIVE-STOCK-OP'],
  });
  assert.equal(Number(operation.rows[0].total), 0);
});

test('un conteo físico obsoleto se rechaza si el stock cambió antes de confirmar en SQLite', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T23:35:00.000Z';
  const productId = 'INV-STALE-PHYSICAL-COUNT';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: [productId, JSON.stringify({ id: productId, nombre: 'Producto Conteo Concurrente', stock: 5, costoUSD: 3 }), at],
    wantRows: false,
  });

  // El operador abrió el conteo cuando había 5 unidades; mientras contaba,
  // otra terminal registró una venta y SQLite quedó con 3.
  await sqliteExecute({
    sql: "UPDATE productos SET data_json=json_set(data_json,'$.stock',3), updated_at=? WHERE id=?",
    args: [at, productId],
    wantRows: false,
  });

  await assert.rejects(
    posStore.applyInventoryMovementsTransaction({
      operationId: 'INV-STALE-PHYSICAL-COUNT-OP',
      operationType: 'AJUSTE_INVENTARIO',
      movements: [{
        id: 'INV-STALE-PHYSICAL-COUNT-MOV', productoId: productId, tipo: 'ajuste_salida',
        cantidad: -1, stockEsperadoAntes: 5, fecha: at, referencia: 'CONTEO FISICO',
      }],
      productPatches: {},
    }),
    /cambió desde que se abrió el conteo físico/i,
  );

  const product = await posStore.getRecord('productos', productId, { id: 'admin-inventory-test', rol: 'administrador' });
  assert.equal(product.stock, 3);
  const movements = await sqliteExecute({
    sql: 'SELECT COUNT(*) AS total FROM movimientos WHERE id=?',
    args: ['INV-STALE-PHYSICAL-COUNT-MOV'],
  });
  assert.equal(Number(movements.rows[0].total), 0);
});

test('un conteo físico vigente aplica el stock contado y no persiste el campo temporal de validación', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T23:40:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO app_config(id,data_json,updated_at) VALUES(?,?,?)',
    args: ['general', JSON.stringify({ tasa: 100 }), at],
    wantRows: false,
  });
  const productId = 'INV-CURRENT-PHYSICAL-COUNT';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: [productId, JSON.stringify({ id: productId, nombre: 'Producto Conteo Vigente', stock: 5, costoUSD: 3 }), at],
    wantRows: false,
  });

  const result = await posStore.applyInventoryMovementsTransaction({
    operationId: 'INV-CURRENT-PHYSICAL-COUNT-OP',
    operationType: 'AJUSTE_INVENTARIO',
    movements: [{
      id: 'INV-CURRENT-PHYSICAL-COUNT-MOV', productoId: productId, tipo: 'ajuste_salida',
      cantidad: -1, stockEsperadoAntes: 5, fecha: at, referencia: 'CONTEO FISICO',
    }],
    productPatches: {},
  });

  assert.equal(result.products[0].stock, 4);
  assert.equal(result.movements[0].stockAntes, 5);
  assert.equal(result.movements[0].stockDespues, 4);
  const persistedMovement = await sqliteExecute({
    sql: 'SELECT data_json FROM movimientos WHERE id=?',
    args: ['INV-CURRENT-PHYSICAL-COUNT-MOV'],
  });
  const savedMovement = JSON.parse(String(persistedMovement.rows[0].data_json));
  assert.equal(Object.hasOwn(savedMovement, 'stockEsperadoAntes'), false);
});


test('la reconciliación Kardex respeta el orden de inserción cuando dos movimientos comparten fecha y hora', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T23:45:00.000Z';
  const productId = 'INV-KARDEX-SAME-TIMESTAMP';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: [productId, JSON.stringify({ id: productId, nombre: 'Producto Movimientos Simultáneos', stock: 999 }), at],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO movimientos(id,data_json,fecha,updated_at) VALUES(?,?,?,?)',
    args: ['ZZZ-FIRST-MOVEMENT', JSON.stringify({
      id: 'ZZZ-FIRST-MOVEMENT', productoId: productId, fecha: at, cantidad: 2, stockAntes: 0, stockDespues: 2,
    }), at, at],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO movimientos(id,data_json,fecha,updated_at) VALUES(?,?,?,?)',
    args: ['AAA-SECOND-MOVEMENT', JSON.stringify({
      id: 'AAA-SECOND-MOVEMENT', productoId: productId, fecha: at, cantidad: 3, stockAntes: 2, stockDespues: 5,
    }), at, at],
    wantRows: false,
  });

  const result = await posStore.syncProductsStockFromKardex();
  const product = await posStore.getRecord('productos', productId, { id: 'admin-inventory-test', rol: 'administrador' });
  assert.equal(product.stock, 5);
  assert.equal(result.source, 'kardex');
});


test('el botón Ajustes del POS registra consumo, colaboración, entradas y salidas en SQLite con trazabilidad de caja', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T23:55:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO app_config(id,data_json,updated_at) VALUES(?,?,?)',
    args: ['general', JSON.stringify({ tasa: 100 }), at],
    wantRows: false,
  });

  const cases = [
    { type: 'consumo', delta: -2, expected: 8, suffix: 'CONSUMO' },
    { type: 'colaboracion', delta: -1, expected: 9, suffix: 'COLABORACION' },
    { type: 'ajuste_salida', delta: -3, expected: 7, suffix: 'SALIDA' },
    { type: 'ajuste_entrada', delta: 4, expected: 14, suffix: 'ENTRADA' },
  ];

  for (const item of cases) {
    const productId = 'POS-AJUSTE-' + item.suffix;
    const movementId = 'POS-AJUSTE-MOV-' + item.suffix;
    const operationId = 'POS-AJUSTE-OP-' + item.suffix;
    await sqliteExecute({
      sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
      args: [productId, JSON.stringify({
        id: productId, nombre: 'Producto ' + item.suffix, stock: 10, costoUSD: 4, activo: true,
      }), at],
      wantRows: false,
    });

    const payload = {
      operationId,
      operationType: 'AJUSTE-INVENTARIO-POS',
      movements: [{
        id: movementId, productoId: productId, tipo: item.type,
        cantidad: item.delta, fecha: at, referencia: item.suffix + ' | PRUEBA POS',
        terminalId: 'CAJA-POS-01',
      }],
      productPatches: {},
    };
    const result = await posStore.applyInventoryMovementsTransaction(payload);
    assert.equal(result.products[0].stock, item.expected, item.type + ' stock final');
    assert.equal(result.movements[0].cantidad, item.delta, item.type + ' signo del movimiento');
    assert.equal(result.movements[0].terminalId, 'CAJA-POS-01', item.type + ' terminal');
    assert.equal(result.movements[0].stockAntes, 10, item.type + ' stock inicial');
    assert.equal(result.movements[0].stockDespues, item.expected, item.type + ' stock posterior');

    if (item.delta < 0) {
      assert.equal(result.movements[0].costoUnitarioUSD, 4, item.type + ' snapshot costo');
      assert.equal(result.movements[0].tasaBCV, 100, item.type + ' snapshot tasa');
    }

    const persistedProduct = await posStore.getRecord('productos', productId, { id: 'admin-pos-adjustment', rol: 'administrador' });
    assert.equal(persistedProduct.stock, item.expected);
    const persistedMovement = await sqliteExecute({
      sql: 'SELECT data_json FROM movimientos WHERE id=?',
      args: [movementId],
    });
    assert.equal(persistedMovement.rows.length, 1);
    const savedMovement = JSON.parse(String(persistedMovement.rows[0].data_json));
    assert.equal(savedMovement.terminalId, 'CAJA-POS-01');
    assert.equal(savedMovement.referencia, item.suffix + ' | PRUEBA POS');

    // Reintentar la misma operación debe recuperar el resultado idempotente,
    // nunca volver a aplicar la variación de existencias.
    const retry = await posStore.applyInventoryMovementsTransaction(payload);
    assert.equal(retry.recovered, true, item.type + ' idempotencia');
    const afterRetry = await posStore.getRecord('productos', productId, { id: 'admin-pos-adjustment', rol: 'administrador' });
    assert.equal(afterRetry.stock, item.expected, item.type + ' no duplica el ajuste');
    const movementCount = await sqliteExecute({
      sql: 'SELECT COUNT(*) AS total FROM movimientos WHERE id=?',
      args: [movementId],
    });
    assert.equal(Number(movementCount.rows[0].total), 1, item.type + ' no duplica el Kardex');
  }
});


test('CxC individual Bs payments preserve six-decimal USD equivalents and close only at the real Bs balance', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T23:59:00.000Z';
  const debtId = 'CXC-SUBCENT-INDIVIDUAL';
  const customerId = 'CUS-CXC-SUBCENT-INDIVIDUAL';
  const customer = { id: customerId, name: 'Cliente Subcent', cedula: 'V-990001', debt: 0.0001 };
  const debt = {
    id: debtId, cliente: 'Cliente Subcent [V-990001]', montoUSD: 0.0001,
    abonadoUSD: 0, saldoUSD: 0.0001, estado: 'pendiente', historialPagos: [],
    fecha: at,
  };
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
    args: [customerId, JSON.stringify(customer), at],
    wantRows: false,
  });
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxc(id,data_json,fecha) VALUES(?,?,?)',
    args: [debtId, JSON.stringify(debt), at],
    wantRows: false,
  });

  const user = { id: 'admin-cxc-subcent', rol: 'administrador', nombre: 'Prueba' };
  const first = await posStore.applyDebtPaymentTransaction({
    operationId: 'PAY-CXC-SUBCENT-001',
    collection: 'cxc',
    debtId,
    amountUSD: 0.000025,
    amountBS: 0.01,
    payment: {
      id: 'PAY-CXC-SUBCENT-001', metodo: 'mixto', montoUSD: 0.000025,
      montoBS: 0.01, tasaAplicada: 400,
      paymentParts: [{ metodo: 'efectivo_bs', montoUSD: 0.000025, montoBS: 0.01 }],
    },
    user,
  });
  assert.equal(first.appliedUSD, 0.000025);
  assert.equal(first.appliedBS, 0.01);
  assert.equal(first.saldoUSD, 0.000075);
  assert.equal(first.estado, 'parcial');
  assert.equal(first.historialPagos[0].montoUSD, 0.000025);

  const second = await posStore.applyDebtPaymentTransaction({
    operationId: 'PAY-CXC-SUBCENT-002',
    collection: 'cxc',
    debtId,
    amountUSD: 0.000075,
    amountBS: 0.03,
    payment: {
      id: 'PAY-CXC-SUBCENT-002', metodo: 'efectivo_bs', montoUSD: 0.000075,
      montoBS: 0.03, tasaAplicada: 400,
    },
    user,
  });
  assert.equal(second.appliedUSD, 0.000075);
  assert.equal(second.appliedBS, 0.03);
  assert.equal(second.saldoUSD, 0);
  assert.equal(second.estado, 'pagada');
  const savedCustomer = JSON.parse(String((await sqliteExecute({
    sql: 'SELECT data_json FROM clientes WHERE id=?', args: [customerId],
  })).rows[0].data_json));
  assert.equal(savedCustomer.debt, 0);
});

test('CxC global Bs payment distributes sub-cent USD amounts without dropping the collection', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-19T23:59:30.000Z';
  const customerId = 'CUS-CXC-GLOBAL-SUBCENT';
  const customer = { id: customerId, name: 'Cliente Global Subcent', cedula: 'V-990002', debt: 0.0002 };
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO clientes(id,data_json,fecha) VALUES(?,?,?)',
    args: [customerId, JSON.stringify(customer), at],
    wantRows: false,
  });
  for (const id of ['CXC-GLOBAL-SUBCENT-1', 'CXC-GLOBAL-SUBCENT-2']) {
    const debt = {
      id, cliente: 'Cliente Global Subcent [V-990002]', montoUSD: 0.0001,
      abonadoUSD: 0, saldoUSD: 0.0001, estado: 'pendiente', historialPagos: [], fecha: at,
    };
    await sqliteExecute({
      sql: 'INSERT OR REPLACE INTO cxc(id,data_json,fecha) VALUES(?,?,?)',
      args: [id, JSON.stringify(debt), at],
      wantRows: false,
    });
  }
  const result = await posStore.applyGlobalCustomerPaymentTransaction({
    operationId: 'PAY-CXC-GLOBAL-SUBCENT-001',
    customerName: 'Cliente Global Subcent',
    customerCedula: 'V-990002',
    amountUSD: 0.00005,
    amountBS: 0.02,
    payment: {
      id: 'PAY-CXC-GLOBAL-SUBCENT-001', metodo: 'mixto', montoUSD: 0.00005,
      montoBS: 0.02, tasaAplicada: 400,
      paymentParts: [{ metodo: 'efectivo_bs', montoUSD: 0.00005, montoBS: 0.02, tasaAplicada: 400 }],
    },
    paymentParts: [{ metodo: 'efectivo_bs', montoUSD: 0.00005, montoBS: 0.02, tasaAplicada: 400 }],
    user: { id: 'admin-cxc-global-subcent', rol: 'administrador', nombre: 'Prueba' },
  });
  assert.equal(result.appliedUSD, 0.00005);
  assert.equal(result.appliedBS, 0.02);
  assert.equal(result.debts.length, 1);
  assert.equal(result.debts[0].saldoUSD, 0.00005);
  const saved = JSON.parse(String((await sqliteExecute({
    sql: 'SELECT data_json FROM cxc WHERE id=?', args: ['CXC-GLOBAL-SUBCENT-1'],
  })).rows[0].data_json));
  assert.equal(saved.saldoUSD, 0.00005);
  assert.equal(saved.historialPagos[0].montoUSD, 0.00005);
});

test('CxP individual Bs payment retains its six-decimal USD equivalent in SQLite', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-20T00:00:00.000Z';
  const debtId = 'CXP-SUBCENT-INDIVIDUAL';
  const debt = {
    id: debtId, proveedor: 'Proveedor Subcent', montoUSD: 0.0001,
    abonadoUSD: 0, saldoUSD: 0.0001, estado: 'pendiente', historialPagos: [], fecha: at,
  };
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO cxp(id,data_json,fecha) VALUES(?,?,?)',
    args: [debtId, JSON.stringify(debt), at],
    wantRows: false,
  });
  const result = await posStore.applyDebtPaymentTransaction({
    operationId: 'PAY-CXP-SUBCENT-001',
    collection: 'cxp',
    debtId,
    amountUSD: 0.000025,
    amountBS: 0.01,
    payment: {
      id: 'PAY-CXP-SUBCENT-001', metodo: 'efectivo_bs', montoUSD: 0.000025,
      montoBS: 0.01, tasaAplicada: 400,
    },
    user: { id: 'admin-cxp-subcent', rol: 'administrador', nombre: 'Prueba' },
  });
  assert.equal(result.appliedUSD, 0.000025);
  assert.equal(result.appliedBS, 0.01);
  assert.equal(result.saldoUSD, 0.000075);
  assert.equal(result.estado, 'parcial');
});


test('CxP global Bs payment preserves sub-cent USD application across supplier invoices', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-20T00:01:00.000Z';
  for (const id of ['CXP-GLOBAL-SUBCENT-1', 'CXP-GLOBAL-SUBCENT-2']) {
    const debt = {
      id, proveedor: 'Proveedor Global Subcent', montoUSD: 0.0001,
      abonadoUSD: 0, saldoUSD: 0.0001, estado: 'pendiente', historialPagos: [], fecha: at,
    };
    await sqliteExecute({
      sql: 'INSERT OR REPLACE INTO cxp(id,data_json,fecha) VALUES(?,?,?)',
      args: [id, JSON.stringify(debt), at],
      wantRows: false,
    });
  }
  const result = await posStore.applyGlobalProviderPaymentTransaction({
    operationId: 'PAY-CXP-GLOBAL-SUBCENT-001',
    provider: 'Proveedor Global Subcent',
    amountUSD: 0.000025,
    amountBS: 0.01,
    payment: {
      id: 'PAY-CXP-GLOBAL-SUBCENT-001', metodo: 'efectivo_bs',
      montoUSD: 0.000025, montoBS: 0.01, tasaAplicada: 400,
    },
  });
  assert.equal(result.appliedUSD, 0.000025);
  assert.equal(result.appliedBS, 0.01);
  assert.equal(result.debts.length, 1);
  assert.equal(result.debts[0].saldoUSD, 0.000075);
  const saved = JSON.parse(String((await sqliteExecute({
    sql: 'SELECT data_json FROM cxp WHERE id=?', args: ['CXP-GLOBAL-SUBCENT-1'],
  })).rows[0].data_json));
  assert.equal(saved.saldoUSD, 0.000075);
  assert.equal(saved.historialPagos[0].montoUSD, 0.000025);
});


test('compra registra pagos iniciales sub-centavo y CxP con seis decimales en SQLite', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-20T12:00:00.000Z';
  const productId = 'PURCHASE-SUBCENT-PRODUCT';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: [productId, JSON.stringify({
      id: productId, nombre: 'Producto Compra Subcentavo', stock: 0, costoUSD: 0,
    }), at],
    wantRows: false,
  });

  const purchase = {
    id: 'PURCHASE-SUBCENT-001', fecha: '2026-11-20', fechaHora: at,
    proveedor: 'Proveedor Subcentavo', numeroFactura: 'FAC-SUBCENT-001',
    condicion: 'mixto', montoUSD: 0.0001, pagadoUSD: 0.000025,
    saldoUSD: 0.000075,
    items: [{ productoId: productId, nombre: 'Producto Compra Subcentavo', cantidad: 1, costoUnitarioUSD: 0.0001, subtotalUSD: 0.0001 }],
  };
  const debt = {
    id: 'CXP-PURCHASE-SUBCENT-001', fecha: '2026-11-20',
    proveedor: 'Proveedor Subcentavo', numeroFactura: 'FAC-SUBCENT-001',
    montoUSD: 0.0001, abonadoUSD: 0.000025, saldoUSD: 0.000075,
    estado: 'parcial',
    historialPagos: [{
      id: 'PAY-PURCHASE-SUBCENT-001', montoUSD: 0.000025,
      montoBS: 0.01, metodo: 'efectivo_bs', tasaAplicada: 400,
    }],
  };
  const journal = {
    id: 'ACC-PURCHASE-SUBCENT-001', fecha: at, tipo: 'egreso',
    categoria: 'COMPRA', montoUSD: 0.000025, montoBS: 0.01,
    metodo: 'efectivo_bs', referencia: 'FAC-SUBCENT-001',
  };
  const result = await posStore.createPurchaseTransaction({
    operationId: 'PURCHASE-SUBCENT-OP-001',
    purchase, items: purchase.items,
    purchaseDate: '2026-11-20', purchaseDateTime: at,
    supplier: 'Proveedor Subcentavo', invoiceNumber: 'FAC-SUBCENT-001',
    exchangeRate: 400, paidUSD: 0.000025, debt, journal,
  });

  assert.equal(result.purchase.pagadoUSD, 0.000025);
  assert.equal(result.purchase.saldoUSD, 0.000075);
  assert.equal(result.debt.abonadoUSD, 0.000025);
  assert.equal(result.debt.saldoUSD, 0.000075);
  assert.equal(result.journal.montoUSD, 0.000025);
  assert.equal(result.journal.montoBS, 0.01);

  const savedDebt = await posStore.getRecord('cxp', debt.id, { id: 'admin-purchase-subcent', rol: 'administrador' });
  assert.equal(savedDebt.historialPagos[0].montoUSD, 0.000025);
  assert.equal(savedDebt.saldoUSD, 0.000075);
});

test('formulario de compras conserva seis decimales y no descarta pagos o saldos sub-centavo', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/components/modules/PurchaseModule.tsx'), 'utf8');
  assert.match(source, /setMontoPagadoUSD\(totalUSD\.toFixed\(6\)\)/);
  assert.match(source, /roundUSD6\(nBS \/ tasaActual\)\.toFixed\(6\)/);
  assert.match(source, /const paidUSD = roundUSD6\(pMontoPagadoUSD\)/);
  assert.match(source, /paidUSD > 0 \?/);
  assert.match(source, /saldoUSD > 0 \?/);
  assert.match(source, /saldoPendienteUSD > 0 \?/);
  assert.doesNotMatch(source, /paidUSD > 0\.0001|saldoUSD > 0\.0001|saldoPendienteUSD > 0\.0001/);
});


test('costo promedio ponderado de inventario conserva seis decimales en ajustes y SQLite', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-20T15:00:00.000Z';
  const productId = 'INV-WEIGHTED-COST-6DP';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: [productId, JSON.stringify({
      id: productId, nombre: 'Producto Costo Ponderado 6D', stock: 3, costoUSD: 1.234567,
    }), at],
    wantRows: false,
  });

  const stockActual = 3;
  const costoActual = 1.234567;
  const cantidadNueva = 2;
  const nuevoCosto = 2.345678;
  const costoPonderado = Math.round((((stockActual * costoActual) + (cantidadNueva * nuevoCosto)) / (stockActual + cantidadNueva) + Number.EPSILON) * 1000000) / 1000000;
  assert.equal(costoPonderado, 1.679011);

  const result = await posStore.applyInventoryMovementsTransaction({
    operationId: 'INV-WEIGHTED-COST-6DP-OP',
    operationType: 'AJUSTE_INVENTARIO',
    movements: [{
      id: 'INV-WEIGHTED-COST-6DP-MOV', productoId: productId, tipo: 'ajuste_entrada',
      cantidad: cantidadNueva, fecha: at, referencia: 'ENTRADA CON COSTO PROMEDIO',
    }],
    productPatches: { [productId]: { costoUSD: costoPonderado } },
  });

  assert.equal(result.products[0].stock, 5);
  assert.equal(result.products[0].costoUSD, 1.679011);
  const saved = await posStore.getRecord('productos', productId, { id: 'admin-weighted-cost-test', rol: 'administrador' });
  assert.equal(saved.costoUSD, 1.679011);

  const inventorySource = fs.readFileSync(path.join(process.cwd(), 'src/components/modules/InventoryModule.tsx'), 'utf8');
  const utilitySource = fs.readFileSync(path.join(process.cwd(), 'src/lib/db-store.ts'), 'utf8');
  assert.match(inventorySource, /Utils\.roundUSD6\(\(\(stockActual \* costoActual\) \+ \(cantidadNueva \* Number\(nuevoCosto\)\)\) \/ stockTotal\)/);
  assert.match(utilitySource, /roundUSD6: \(v: any\) =>[\s\S]*?Math\.round\(\(n \+ Number\.EPSILON\) \* 1000000\) \/ 1000000/);
  assert.doesNotMatch(inventorySource, /Utils\.round\(\(\(stockActual \* costoActual\)/);
  const storeSource = fs.readFileSync(path.join(process.cwd(), 'src/lib/sqlite/pos-store.ts'), 'utf8');
  assert.match(storeSource, /Math\.round\(\(\(\(oldStock\*oldCost\)\+\(qty\*cost\)\)\/newStock\+Number\.EPSILON\)\*1000000\)\/1000000/);
  assert.match(storeSource, /Math\.round\(\(beforeValue\/beforeStock\+Number\.EPSILON\)\*1000000\)\/1000000/);
});


test('compra recalcula y persiste costo promedio ponderado con seis decimales', async () => {
  await schema.ensureSqliteSchema();
  const at = '2026-11-20T15:10:00.000Z';
  const productId = 'PURCHASE-WEIGHTED-COST-6DP';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: [productId, JSON.stringify({ id: productId, nombre: 'Producto Compra Costo 6D', stock: 3, costoUSD: 1.234567 }), at],
    wantRows: false,
  });
  const purchase = {
    id: 'PURCHASE-WEIGHTED-COST-6DP-001', fecha: '2026-11-20', fechaHora: at,
    proveedor: 'Proveedor Costo 6D', numeroFactura: 'FAC-COSTO-6D-001',
    montoUSD: 4.691356, pagadoUSD: 4.691356, saldoUSD: 0, items: [],
  };
  const items = [{ productoId: productId, nombre: 'Producto Compra Costo 6D', cantidad: 2, costoUnitarioUSD: 2.345678, subtotalUSD: 4.691356 }];
  const result = await posStore.createPurchaseTransaction({
    operationId: 'PURCHASE-WEIGHTED-COST-6DP-OP', purchase, items,
    purchaseDate: '2026-11-20', purchaseDateTime: at,
    supplier: 'Proveedor Costo 6D', invoiceNumber: 'FAC-COSTO-6D-001', exchangeRate: 400,
  });
  assert.equal(result.products[0].stock, 5);
  assert.equal(result.products[0].costoUSD, 1.679011);
  const saved = await posStore.getRecord('productos', productId, { id: 'admin-purchase-cost-6dp', rol: 'administrador' });
  assert.equal(saved.costoUSD, 1.679011);
});

test('rechaza compra atrasada cuando existen ventas posteriores que exigirían recalcular su costo histórico', async () => {
  await schema.ensureSqliteSchema();
  const productId = 'PURCHASE-BACKDATED-SALE-GUARD';
  const initialAt = '2026-11-19T09:00:00.000Z';
  await sqliteExecute({
    sql: 'INSERT OR REPLACE INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
    args: [productId, JSON.stringify({ id: productId, nombre: 'Producto compra atrasada', stock: 5, costoUSD: 8 }), initialAt],
    wantRows: false,
  });

  await posStore.createPurchaseTransaction({
    operationId: 'PURCHASE-BACKDATED-BASE-OP',
    purchase: {
      id: 'PURCHASE-BACKDATED-BASE', fecha: '2026-11-19', fechaHora: '2026-11-19T10:00:00.000Z',
      proveedor: 'Proveedor Base', numeroFactura: 'FAC-BACKDATED-BASE',
      montoUSD: 30, items: [{ productoId: productId, cantidad: 3, costoUnitarioUSD: 10 }],
    },
    items: [{ productoId: productId, cantidad: 3, costoUnitarioUSD: 10, subtotalUSD: 30 }],
    purchaseDate: '2026-11-19', purchaseDateTime: '2026-11-19T10:00:00.000Z',
    supplier: 'Proveedor Base', invoiceNumber: 'FAC-BACKDATED-BASE', exchangeRate: 370,
  });

  const saleAt = '2026-11-19T12:00:00.000Z';
  await sqliteExecute({
    sql: 'INSERT INTO movimientos(id,data_json,fecha) VALUES(?,?,?)',
    args: ['PURCHASE-BACKDATED-SALE-MOV', JSON.stringify({
      id: 'PURCHASE-BACKDATED-SALE-MOV', productoId: productId, tipo: 'venta', cantidad: -2,
      stockAntes: 8, stockDespues: 6, costoUnitarioUSD: 8.75,
      fecha: saleAt, referencia: 'VENTA POSTERIOR TEST',
    }), saleAt],
    wantRows: false,
  });
  await sqliteExecute({
    sql: "UPDATE productos SET data_json=json_set(data_json,'$.stock',6) WHERE id=?",
    args: [productId],
    wantRows: false,
  });

  await assert.rejects(
    posStore.createPurchaseTransaction({
      operationId: 'PURCHASE-BACKDATED-NEW-OP',
      purchase: {
        id: 'PURCHASE-BACKDATED-NEW', fecha: '2026-11-19', fechaHora: '2026-11-19T11:00:00.000Z',
        proveedor: 'Proveedor Atrasado', numeroFactura: 'FAC-BACKDATED-NEW',
        montoUSD: 48, items: [{ productoId: productId, cantidad: 4, costoUnitarioUSD: 12 }],
      },
      items: [{ productoId: productId, cantidad: 4, costoUnitarioUSD: 12, subtotalUSD: 48 }],
      purchaseDate: '2026-11-19', purchaseDateTime: '2026-11-19T11:00:00.000Z',
      supplier: 'Proveedor Atrasado', invoiceNumber: 'FAC-BACKDATED-NEW', exchangeRate: 370,
    }),
    /movimientos posteriores de tipo venta/,
  );

  const product = await posStore.getRecord('productos', productId, { id: 'admin-backdated-purchase-test', rol: 'administrador' });
  assert.equal(product.stock, 6);
  assert.equal(product.costoUSD, 8.75);
  assert.equal(await posStore.getRecord('compras', 'PURCHASE-BACKDATED-NEW', { id: 'admin-backdated-purchase-test', rol: 'administrador' }), null);
  assert.equal(await posStore.getRecord('movimientos', 'PURCHASE-BACKDATED-SALE-MOV', { id: 'admin-backdated-purchase-test', rol: 'administrador' }).then(m => m.costoUnitarioUSD), 8.75);
});
