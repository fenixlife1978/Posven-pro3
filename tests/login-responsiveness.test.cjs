const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const login = fs.readFileSync(path.join(root, 'src/app/login/page.tsx'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src/lib/db-store.ts'), 'utf8');
const desktop = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

test('login descarta el identificador de sesión de pestaña anterior antes de validar sesión', () => {
  const clear = login.indexOf('sessionStorage.removeItem(POSVEN_TAB_SESSION_KEY)');
  const install = login.indexOf('installLoginTabSessionFetch();', clear);
  const check = login.indexOf('fetch("/api/auth/session"', install);
  assert.ok(clear >= 0, 'debe limpiar el identificador anterior');
  assert.ok(install > clear, 'debe instalar el fetch después de limpiar');
  assert.ok(check > install, 'debe comprobar la sesión después de limpiar');
});

test('login tiene límite de espera y cancela las peticiones al desmontar', () => {
  assert.match(login, /AbortController/);
  assert.match(login, /setTimeout\(\(\) => controller\.abort\(\), 10000\)/);
  assert.match(login, /controller\.abort\(\)/);
});

test('el login enfoca una sola vez y no roba el foco durante la escritura', () => {
  assert.match(login, /requestAnimationFrame/);
  assert.match(login, /field\.focus\(\{ preventScroll: true \}\)/);
  assert.match(login, /reactivateLoginForm/);
  assert.match(login, /posven-login-identifier/);
  assert.match(login, /posven-login-password/);
  assert.match(login, /autoFocus/);
  assert.doesNotMatch(login, /delays = \[0, 80, 220, 450, 850\]/);
  assert.doesNotMatch(login, /setTimeout\(focusField/);
  assert.match(login, /disabled=\{false\} readOnly=\{false\} tabIndex=\{0\}/);
  assert.match(login, /field\.disabled = false/);
  assert.match(login, /field\.readOnly = false/);
  assert.match(login, /window\.addEventListener\("focus", focusWhenWindowReturns\)/);
  assert.match(login, /document\.addEventListener\("visibilitychange", focusWhenWindowReturns\)/);
  assert.match(login, /pointer-events-none absolute left-4/);
});

test('sondeos SQLite de fondo se serializan y se suspenden con ventana oculta', () => {
  assert.match(store, /sqlitePollingTaskActive/);
  assert.match(store, /document\.visibilityState === 'hidden'/);
  assert.match(store, /document\.addEventListener\('visibilitychange'/);
});

test('Electron devuelve el foco del teclado al contenido web al recuperar la ventana', () => {
  assert.match(desktop, /mainWindow\.on\('focus',[\s\S]*?mainWindow\.webContents\.focus\(\)/);
});
