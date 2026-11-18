const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const login = fs.readFileSync(path.join(root, 'src/app/login/page.tsx'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src/lib/db-store.ts'), 'utf8');

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

test('al mostrar el formulario se reintenta el foco y permite reactivar campos', () => {
  assert.match(login, /requestAnimationFrame/);
  assert.match(login, /delays = \[0, 80, 220, 450, 850\]/);
  assert.match(login, /field\.focus\(\{ preventScroll: true \}\)/);
  assert.match(login, /reactivateLoginForm/);
  assert.match(login, /posven-login-identifier/);
  assert.match(login, /disabled=\{false\} readOnly=\{false\} tabIndex=\{0\}/);
});

test('sondeos SQLite de fondo se serializan y se suspenden con ventana oculta', () => {
  assert.match(store, /sqlitePollingTaskActive/);
  assert.match(store, /document\.visibilityState === 'hidden'/);
  assert.match(store, /document\.addEventListener\('visibilitychange'/);
});
