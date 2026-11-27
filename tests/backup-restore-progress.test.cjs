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
  assert.match(backup, /xhr\.timeout = 0/);
  assert.doesNotMatch(backup, /xhr\.timeout = 15 \* 60 \* 1000/);
  assert.match(backup, /No vuelva a intentarlo a ciegas/);
  assert.match(backup, /xhr\.onerror/);
  assert.match(backup, /xhr\.ontimeout/);
});

const backupRoute = fs.readFileSync(path.join(__dirname, '..', 'src/app/api/pos/backup/route.ts'), 'utf8');

test('la API consume el cuerpo limitado mientras espera la autenticación SQLite', () => {
  assert.match(backupRoute, /const maxBackupBytes = getMaxBackupBytes\(\)/);
  assert.match(backupRoute, /const maxRequestBytes = maxBackupBytes \+ MAX_REQUEST_OVERHEAD_BYTES/);
  assert.match(backupRoute, /content-length/);
  assert.match(backupRoute, /const authPromise = requireAdmin\(request\)/);
  assert.match(backupRoute, /const bodyPromise = readJsonBodyLimited\(request, maxRequestBytes\)/);
  assert.match(backupRoute, /Promise\.all\(\[authPromise, bodyPromise\]\)/);
  assert.match(backupRoute, /request\.body\.getReader\(\)/);
  assert.match(backupRoute, /totalBytes > maxBytes/);
  assert.match(backupRoute, /Buffer\.byteLength\(JSON\.stringify\(backup\), 'utf8'\) > maxBackupBytes/);
  assert.match(backupRoute, /getMaxBackupBytes/);
  assert.doesNotMatch(backup, /content\.length > 64 \* 1024 \* 1024/);
});

test('un manifiesto declarado incompleto requiere confirmación explícita antes de iniciar XHR', () => {
  assert.match(backup, /detectarRespaldoTursoTruncado/);
  assert.match(backup, /validarRespaldoParaRestauracion\(backup, allowPartialTursoRestore\)/);
  assert.match(backup, /incompleteManifest && !allowPartialTursoRestore/);
  assert.match(backup, /confirmPartialTursoRestore: allowPartialTursoRestore/);
  // La cantidad de filas deja de ser señal de truncamiento: un respaldo con
  // 10.000 o más ventas/movimientos no se bloquea ni se marca como parcial.
  assert.match(backup, /incompleteManifest: backup\?\.meta\?\.complete === false/);
  assert.doesNotMatch(backup, /=== 10000/);
  const config = fs.readFileSync(path.join(__dirname, '..', 'src/components/modules/ConfigModule.tsx'), 'utf8');
  assert.match(config, /manifiesto incompleto|MANIFIESTO INCOMPLETO/i);
  assert.match(config, /¿Autoriza restaurar este respaldo declarado como incompleto/);
  assert.doesNotMatch(config, /límite de 10\.000/);
  assert.match(config, /cargarRespaldoDesdeContenido\(content, \(progress\) => setBackupProgress\(progress\), allowPartialTursoRestore\)/);
  const store = fs.readFileSync(path.join(__dirname, '..', 'src/lib/sqlite/pos-store.ts'), 'utf8');
  assert.match(store, /allowPartialTursoRestore\?: boolean/);
  assert.match(store, /params\.allowPartialTursoRestore !== true/);
  assert.doesNotMatch(store, /Number\(count\) >= 10000/);
  const route = fs.readFileSync(path.join(__dirname, '..', 'src/app/api/pos/backup/route.ts'), 'utf8');
  assert.match(route, /confirmPartialTursoRestore === true/);
});

const sqliteStore = fs.readFileSync(path.join(__dirname, '..', 'src/lib/sqlite/pos-store.ts'), 'utf8');

test('los respaldos exportan y restauran todas las operaciones sin topes de cantidad', () => {
  assert.match(sqliteStore, /SELECT id,data_json FROM ' \+ entry\.table \+ ' ORDER BY rowid/);
  assert.doesNotMatch(sqliteStore, /200000|200\.000/);
  assert.match(sqliteStore, /const RESTORE_BATCH_SIZE = 500/);
  assert.match(sqliteStore, /for \(let offset = 0; offset < rows\.length; offset \+= RESTORE_BATCH_SIZE\)/);
  assert.match(sqliteStore, /await tx\.executeBatch\(batch\.map\(\(row: any\) => rowStatement\(entry\.table, row\)\)\)/);
  // Se conserva únicamente el límite técnico de bytes; no es un tope de operaciones.
  assert.match(sqliteStore, /export function getMaxBackupBytes\(\)/);
  assert.match(sqliteStore, /Buffer\.byteLength\(JSON\.stringify\(snapshot\), 'utf8'\) > getMaxBackupBytes\(\)/);
});


test('ruta de restauración limita también cuerpos chunked sin Content-Length', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/pos/backup/route.ts'), 'utf8');
  assert.match(route, /request\.body\.getReader\(\)/);
  assert.match(route, /totalBytes \+= value\.byteLength/);
  assert.match(route, /totalBytes > maxBytes/);
  assert.match(route, /reader\.cancel\(\)/);
  assert.match(route, /readJsonBodyLimited\(request, maxRequestBytes\)/);
  assert.doesNotMatch(route, /const bodyPromise = request\.json\(\)/);
});