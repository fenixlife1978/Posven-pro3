const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const backup = fs.readFileSync(path.join(root, 'src/lib/backup.ts'), 'utf8');
const backupRoute = fs.readFileSync(path.join(root, 'src/app/api/pos/backup/route.ts'), 'utf8');
const sqliteStore = fs.readFileSync(path.join(root, 'src/lib/sqlite/pos-store.ts'), 'utf8');
const desktop = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src/components/modules/ConfigModule.tsx'), 'utf8');

test('la restauración informa progreso de transferencia y distingue el procesamiento SQLite', () => {
  assert.match(backup, /xhr\.upload\.onprogress/);
  assert.match(backup, /Enviados .* de .* MB/);
  assert.match(backup, /stage: 'Procesando en SQLite'/);
  assert.match(backup, /Archivo recibido\. Validando datos, creando copia de seguridad y restaurando la base de datos/);
});

test('la carga de respaldo no impone límites de bytes en selector Electron ni API', () => {
  assert.match(desktop, /if \(!stat\.isFile\(\) \|\| stat\.size <= 0\)/);
  assert.doesNotMatch(desktop, /stat\.size > 64 \* 1024 \* 1024/);
  assert.match(backupRoute, /request\.body\.getReader\(\)/);
  assert.match(backupRoute, /chunks\.push\(value\)/);
  assert.doesNotMatch(backupRoute, /maxBackupBytes|maxRequestBytes|totalBytes > maxBytes|status: 413/);
  assert.doesNotMatch(sqliteStore, /getMaxBackupBytes|POSVEN_MAX_BACKUP_BYTES/);
  assert.doesNotMatch(sqliteStore, /Buffer\.byteLength\(JSON\.stringify\(snapshot\), 'utf8'\) > getMaxBackupBytes\(\)/);
});

test('el conteo de 10.000 no bloquea ni exige confirmación especial al restaurar', () => {
  assert.doesNotMatch(backup, /detectarRespaldoTursoTruncado|validarRespaldoParaRestauracion|confirmPartialTursoRestore|10000/);
  assert.doesNotMatch(config, /detectarRespaldoTursoTruncado|cappedTables|límite de 10\.000|¿Autoriza la restauración parcial\?/);
  assert.doesNotMatch(sqliteStore, /Number\(count\) >= 10000|allowPartialTursoRestore/);
  assert.match(sqliteStore, /const RESTORE_BATCH_SIZE = 500/);
  assert.match(sqliteStore, /for \(let offset = 0; offset < rows\.length; offset \+= RESTORE_BATCH_SIZE\)/);
  assert.match(sqliteStore, /await tx\.executeBatch\(batch\.map\(\(row: any\) => rowStatement\(entry\.table, row\)\)\)/);
});

test('exportación SQLite lee el conjunto completo de filas y no aplica tope de operaciones', () => {
  assert.match(sqliteStore, /SELECT id,data_json FROM ' \+ entry\.table \+ ' ORDER BY rowid/);
  const exportStart = sqliteStore.indexOf('exportBackupSnapshot');
  const exportEnd = sqliteStore.indexOf('export async function listRecords', exportStart);
  const exportSection = sqliteStore.slice(exportStart, exportEnd);
  assert.doesNotMatch(exportSection, /LIMIT\s+\d+|getMaxBackupBytes|POSVEN_MAX_BACKUP_BYTES/);
});
