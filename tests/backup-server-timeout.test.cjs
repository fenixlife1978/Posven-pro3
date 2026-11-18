const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktopServer = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const workerServer = fs.readFileSync(path.join(__dirname, '..', 'server-worker.js'), 'utf8');

test('el proxy HTTPS de escritorio no corta restauraciones SQLite a los 120 segundos', () => {
  assert.match(desktopServer, /LONG_OPERATION_TIMEOUT_MS = 15 \* 60 \* 1000/);
  assert.match(desktopServer, /upstream\.setTimeout\(LONG_OPERATION_TIMEOUT_MS/);
  assert.match(desktopServer, /nextServer\.requestTimeout = LONG_OPERATION_TIMEOUT_MS/);
  assert.doesNotMatch(desktopServer, /upstream\.setTimeout\(120000/);
});

test('el servidor interno Next.js acepta el cuerpo completo de una restauración prolongada', () => {
  assert.match(workerServer, /server\.requestTimeout = 15 \* 60 \* 1000/);
  assert.match(workerServer, /server\.timeout = 0/);
});
