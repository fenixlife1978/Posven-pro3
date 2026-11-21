const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posven3-idempotency-test-'));
process.env.POSVEN_SQLITE_PATH = path.join(tempDir, 'posven3-test.sqlite');
require.extensions['.ts'] = (loadedModule, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
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
    if (typeof request === 'string' && !path.extname(request)) return originalResolveFilename.call(this, request + '.ts', parent, isMain, options);
    throw error;
  }
};
const { sqliteExecute } = require('../src/lib/sqlite/client.ts');
const schema = require('../src/lib/sqlite/schema-init.ts');
const posStore = require('../src/lib/sqlite/pos-store.ts');

test('un administrador no puede recuperar una venta idempotente desde una terminal distinta', async () => {
  await schema.ensureSqliteSchema();
  const now = '2026-11-21T10:00:00.000Z';
  const terminals = ['IDEMP-BOX1', 'IDEMP-BOX2'].map(id => ({
    id, nombre: id, prefijoCaja: id, isCashOpen: true,
    cashData: { openDate: now, openedBy: 'Test' },
    proximoRecibo: 1, cashHistory: [], ultimoZ: 0,
  }));
  for (const terminal of terminals) await sqliteExecute({
    sql: 'INSERT INTO terminales(id,data_json,fecha) VALUES(?,?,?)',
    args: [terminal.id, JSON.stringify(terminal), now], wantRows: false,
  });
  const product = { id: 'IDEMP-PRODUCT', nombre: 'Producto prueba idempotencia', stock: 5, costoUSD: 1 };
  await sqliteExecute({
    sql: 'INSERT INTO productos(id,data_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)',
    args: [product.id, JSON.stringify(product)], wantRows: false,
  });
  const user = { id: 'admin-idempotency-test', rol: 'administrador', nombre: 'Administrador' };
  const request = terminalId => posStore.createSaleTransaction({
    operationId: 'ADMIN-CROSS-TERMINAL-IDEMPOTENCY',
    cart: [{ productoId: product.id, nombre: product.nombre, cantidad: 1, precioUnitUSD: 5, subtotalUSD: 5 }],
    payments: [{ metodo: 'efectivo_usd', montoUSD: 5, montoBS: 0 }],
    clientName: 'CONTADO', terminalId, now, tasa: 1, user,
  });
  const original = await request('IDEMP-BOX1');
  const replay = await request('IDEMP-BOX2');
  assert.equal(replay.recovered, true);
  assert.equal(replay.sale.id, original.sale.id, 'debe devolver el comprobante original');
  assert.equal(replay.terminal.id, original.terminal.id, 'la recuperación debe preservar la terminal original, no la terminal del reintento');
  const stock = await sqliteExecute({ sql: 'SELECT data_json FROM productos WHERE id=?', args: [product.id] });
  assert.equal(JSON.parse(stock.rows[0].data_json).stock, 4, 'el reintento no debe descontar stock nuevamente');
});
