const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8');

// El instalador ejecuta Next.js dentro de un UtilityProcess de Electron. Las
// pruebas de la suite dejan better-sqlite3 compilado para Node, así que el
// workflow debe recompilarlo para Electron antes de empaquetar: si viaja el
// binario de Node, la interfaz carga pero todas las rutas API fallan.
test('el workflow recompila better-sqlite3 para el ABI de Electron antes de empaquetar', () => {
  const testsIndex = workflow.indexOf('name: Run regression tests');
  const rebuildIndex = workflow.indexOf('name: Rebuild SQLite binding for the Electron ABI');
  const packageIndex = workflow.indexOf('npx electron-builder');

  assert.ok(testsIndex > -1, 'falta el paso de pruebas de regresión');
  assert.ok(rebuildIndex > testsIndex, 'la recompilación para Electron debe ejecutarse después de las pruebas para Node');
  assert.ok(packageIndex > rebuildIndex, 'el empaquetado debe ejecutarse después de instalar el binario de Electron');

  assert.match(workflow, /better-sqlite3-v\$sqliteVersion-electron-v\$abi-win32-x64\.tar\.gz/);
  assert.match(workflow, /getAbi\('\$electronVersion','electron'\)/);
  // El addon nativo se carga al abrir la base, no con require().
  assert.match(workflow, /new D\(':memory:'\)/);
});

test('el proceso de datos informa el fallo real si el módulo nativo no carga', () => {
  const worker = fs.readFileSync(path.join(root, 'server-worker.js'), 'utf8');
  assert.match(worker, /El controlador SQLite no puede cargarse en este proceso/);

  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /posven3-arranque\.log/);
});
