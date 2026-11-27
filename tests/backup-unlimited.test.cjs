const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.join(__dirname, '..');

// Carga el módulo de respaldos escrito en TypeScript con el mismo arnés que
// usan las demás pruebas del repositorio (transpilado a CommonJS en memoria).
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

const { detectarRespaldoTursoTruncado, validarRespaldoParaRestauracion } = require(path.join(root, 'src/lib/backup.ts'));

function crearRespaldo(cantidadMovimientos, meta) {
  const ventas = Array.from({ length: cantidadMovimientos }, (_, index) => ({ id: 'V-' + index, total: 1 }));
  const movimientos = Array.from({ length: cantidadMovimientos }, (_, index) => ({ id: 'M-' + index, fecha: '2026-01-01' }));
  return {
    app: 'posven-pro',
    version: 3,
    createdAt: new Date().toISOString(),
    data: { ventas, movimientos, productos: [], cxc: [], cxp: [], clientes: [], proveedores: [] },
    meta,
  };
}

test('un respaldo con 25.000 ventas y movimientos no se bloquea ni se marca como truncado', () => {
  const backup = crearRespaldo(25000, {
    source: 'turso',
    tursoTables: { ventas: 25000, movimientos: 25000 },
  });
  const detected = detectarRespaldoTursoTruncado(backup);
  assert.equal(detected.incompleteManifest, false);
  assert.equal(detected.movementCount, 25000);
  assert.doesNotThrow(() => validarRespaldoParaRestauracion(backup));
});

test('un conteo de exactamente 10.000 registros ya no se interpreta como truncamiento', () => {
  const backup = crearRespaldo(10000, {
    source: 'turso',
    tursoTables: { ventas: 10000, movimientos: 10000 },
  });
  assert.equal(detectarRespaldoTursoTruncado(backup).incompleteManifest, false);
  assert.doesNotThrow(() => validarRespaldoParaRestauracion(backup));
});

test('un respaldo local grande (200.000 filas) se restaura sin topes de cantidad', () => {
  const backup = crearRespaldo(200000, {
    source: 'sqlite-local',
    complete: true,
    sqliteTables: { ventas: 200000, movimientos: 200000 },
  });
  assert.doesNotThrow(() => validarRespaldoParaRestauracion(backup));
});

test('solo un manifiesto explicitamente incompleto exige confirmación del administrador', () => {
  const backup = crearRespaldo(15000, { source: 'turso', complete: false });
  assert.equal(detectarRespaldoTursoTruncado(backup).incompleteManifest, true);
  assert.throws(() => validarRespaldoParaRestauracion(backup), /manifiesto incompleto/i);
  assert.doesNotThrow(() => validarRespaldoParaRestauracion(backup, true));
});

test('no quedan topes de tamaño ni de cantidad hardcodeados en exportación y restauración', () => {
  const store = fs.readFileSync(path.join(root, 'src/lib/sqlite/pos-store.ts'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'src/app/api/pos/backup/route.ts'), 'utf8');
  const backup = fs.readFileSync(path.join(root, 'src/lib/backup.ts'), 'utf8');

  // Sin variable de entorno, el límite técnico de bytes no existe.
  assert.match(store, /configured \>= 1024 \* 1024\s*\?\s*configured\s*:\s*Infinity/);
  for (const source of [store, main, route, backup]) {
    assert.doesNotMatch(source, /64 \* 1024 \* 1024/);
    assert.doesNotMatch(source, /Number\(count\) [=><]+ 10000/);
  }
  // El tamaño del archivo seleccionado en Electron solo se limita si el
  // operador configuró POSVEN_MAX_BACKUP_BYTES.
  assert.match(main, /hasConfiguredLimit && stat\.size > configuredMaxBytes/);
  assert.match(main, /POSVEN_MAX_BACKUP_BYTES/);
});
