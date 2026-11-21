const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posven3-inventory-page-'));
process.env.POSVEN_SQLITE_PATH = path.join(tempDir, 'inventory-page.sqlite');

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

const { sqliteExecute, sqliteInteractiveTransaction, assertSQLiteReady } = require('../src/lib/sqlite/client.ts');
const schema = require('../src/lib/sqlite/schema-init.ts');
const { listProductsPage, listRecords } = require('../src/lib/sqlite/pos-store.ts');

after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

test('el catálogo SQLite pagina más de 5.000 productos y calcula filtros y stock bajo en servidor', async () => {
  assertSQLiteReady();
  await schema.ensureSqliteSchema();

  await sqliteInteractiveTransaction(async tx => {
    for (let i = 1; i <= 5005; i += 1) {
      const sequence = String(i).padStart(5, '0');
      const special = i === 5001;
      const lowStock = i % 1000 === 0;
      const product = {
        id: 'PAGE-' + sequence,
        codigo: 'SKU-' + sequence,
        nombre: special ? 'Queso Maduro' : 'Artículo ' + sequence,
        departamento: special ? 'Lácteos' : 'Bebidas',
        categoria: special ? 'Quesos' : 'General',
        activo: true,
        stock: lowStock ? 0 : 5,
        stockMinimo: 1,
      };
      await tx.execute({
        sql: 'INSERT INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
        args: [product.id, JSON.stringify(product), '2026-11-20T12:00:00.000Z'],
        wantRows: false,
      });
    }
    const inactive = {
      id: 'PAGE-INACTIVE', codigo: 'SKU-INACTIVE', nombre: 'Artículo inactivo',
      departamento: 'Bebidas', categoria: 'General', activo: false, stock: 0, stockMinimo: 1,
    };
    await tx.execute({
      sql: 'INSERT INTO productos(id,data_json,updated_at) VALUES(?,?,?)',
      args: [inactive.id, JSON.stringify(inactive), '2026-11-20T12:00:00.000Z'],
      wantRows: false,
    });
  });

  const first = await listProductsPage({ page: 1, pageSize: 10 });
  const last = await listProductsPage({ page: 501, pageSize: 10 });
  assert.equal(first.total, 5005);
  assert.equal(first.records.length, 10);
  assert.equal(last.total, 5005);
  assert.equal(last.records.length, 5);
  assert.equal(first.lowStockTotal, 5);
  assert.equal(last.lowStockTotal, 5);
  assert.equal(new Set([...first.records, ...last.records].map(product => product.id)).size, 15);
  assert.ok(![...first.records, ...last.records].some(product => product.id === 'PAGE-INACTIVE'));

  const filtered = await listProductsPage({
    page: 1,
    pageSize: 10,
    search: 'queso maduro',
    departamento: 'lacteos',
    categoria: 'quesos',
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.lowStockTotal, 0);
  assert.equal(filtered.records[0].id, 'PAGE-05001');

  const byCode = await listProductsPage({ page: 1, pageSize: 10, search: 'sku-05001' });
  assert.equal(byCode.total, 1);
  assert.equal(byCode.records[0].codigo, 'SKU-05001');

  const beyondEnd = await listProductsPage({ page: 502, pageSize: 10 });
  assert.equal(beyondEnd.total, 5005);
  assert.equal(beyondEnd.records.length, 0);

  // La hidratación operativa completa usa el mismo endpoint de lectura
  // paginada, no una ventana fija de 5.000 registros.
  const [batch1, batch2, batch3] = await Promise.all([
    listRecords('productos', { limit: 2000, offset: 0 }),
    listRecords('productos', { limit: 2000, offset: 2000 }),
    listRecords('productos', { limit: 2000, offset: 4000 }),
  ]);
  assert.equal(batch1.length, 2000);
  assert.equal(batch2.length, 2000);
  assert.equal(batch3.length, 1006, 'incluye los 5.005 activos y el registro inactivo');
  const hydratedIds = [...batch1, ...batch2, ...batch3].map(product => product.id);
  assert.equal(new Set(hydratedIds).size, 5006);
  assert.ok(hydratedIds.includes('PAGE-INACTIVE'));
});
