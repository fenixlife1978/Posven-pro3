const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backup = fs.readFileSync(path.join(__dirname, '..', 'src/lib/backup.ts'), 'utf8');

test('la restauración informa el progreso real de transferencia y distingue el procesamiento SQLite', () => {
  assert.match(backup, /xhr\.upload\.onprogress/);
  assert.match(backup, /Enviados .* de .* MB/);
  assert.match(backup, /stage: 'Procesando en SQLite'/);
  assert.match(backup, /Archivo recibido\. Validando datos, creando copia de seguridad y restaurando la base de datos/);
  assert.doesNotMatch(backup, /percent: 5, stage: 'Preparando'/);
});

test('la restauración permite procesos largos y advierte ante timeout sin reintento ciego', () => {
  assert.match(backup, /xhr\.timeout = 15 \* 60 \* 1000/);
  assert.match(backup, /No vuelva a intentarlo a ciegas/);
  assert.match(backup, /xhr\.onerror/);
  assert.match(backup, /xhr\.ontimeout/);
});
