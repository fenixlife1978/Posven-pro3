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

const backupRoute = fs.readFileSync(path.join(__dirname, '..', 'src/app/api/pos/backup/route.ts'), 'utf8');

test('la API consume el cuerpo limitado mientras espera la autenticación SQLite', () => {
  assert.match(backupRoute, /MAX_REQUEST_BYTES = MAX_BACKUP_BYTES \+ 128 \* 1024/);
  assert.match(backupRoute, /content-length/);
  assert.match(backupRoute, /const authPromise = requireAdmin\(request\)/);
  assert.match(backupRoute, /const bodyPromise = request\.json\(\)/);
  assert.match(backupRoute, /Promise\.all\(\[authPromise, bodyPromise\]\)/);
  assert.match(backupRoute, /Buffer\.byteLength\(JSON\.stringify\(backup\), 'utf8'\)/);
});

test('un respaldo Turso posiblemente truncado se rechaza antes de iniciar XHR', () => {
  const validation = backup.indexOf('validarRespaldoParaRestauracion(backup);');
  const send = backup.indexOf('xhr.send(payload)');
  assert.ok(validation >= 0, 'debe validar el manifiesto antes de enviar');
  assert.ok(send > validation, 'el envío debe ocurrir después de la prevalidación');
  assert.match(backup, /Number\(count\) >= 10000/);
  assert.match(backup, /detuvo la carga antes de enviar el archivo/);
});
