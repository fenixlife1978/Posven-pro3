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
  assert.ok(backup.includes('xhr.upload.onprogress'));
  assert.ok(backup.includes('Enviados '));
  assert.ok(backup.includes("stage: 'Procesando en SQLite'"));
  assert.ok(backup.includes('Archivo recibido. Validando datos, creando copia de seguridad y restaurando la base de datos.'));
});

test('la carga de respaldo no impone límites artificiales de bytes', () => {
  assert.ok(desktop.includes('if (!stat.isFile() || stat.size <= 0)'));
  assert.ok(!desktop.includes('stat.size > 64 * 1024 * 1024'));
  assert.ok(backupRoute.includes('request.body.getReader()'));
  assert.ok(backupRoute.includes('chunks.push(value)'));
  assert.ok(!backupRoute.includes('maxBackupBytes'));
  assert.ok(!backupRoute.includes('maxRequestBytes'));
  assert.ok(!sqliteStore.includes('getMaxBackupBytes'));
  assert.ok(!sqliteStore.includes('POSVEN_MAX_BACKUP_BYTES'));
});

test('el conteo de 10.000 no bloquea ni exige confirmación especial al restaurar', () => {
  assert.ok(!backup.includes('detectarRespaldoTursoTruncado'));
  assert.ok(!backup.includes('validarRespaldoParaRestauracion'));
  assert.ok(!backup.includes('confirmPartialTursoRestore'));
  assert.ok(!config.includes('cappedTables'));
  assert.ok(!config.includes('límite de 10.000'));
  assert.ok(!sqliteStore.includes('allowPartialTursoRestore'));
  assert.ok(!sqliteStore.includes('El conteo del respaldo no coincide en'));
  assert.ok(sqliteStore.includes('const RESTORE_BATCH_SIZE = 500'));
  assert.ok(sqliteStore.includes('offset < rows.length'));
  assert.ok(sqliteStore.includes('await tx.executeBatch(batch.map((row: any) => rowStatement(entry.table, row)))'));
});

test('exportación SQLite lee el conjunto completo de filas y no aplica tope de operaciones', () => {
  assert.ok(sqliteStore.includes("SELECT id,data_json FROM ' + entry.table + ' ORDER BY rowid"));
  const exportStart = sqliteStore.indexOf('exportBackupSnapshot');
  const exportEnd = sqliteStore.indexOf('export async function listRecords', exportStart);
  const exportSection = sqliteStore.slice(exportStart, exportEnd);
  assert.ok(!exportSection.includes('getMaxBackupBytes'));
  assert.ok(!exportSection.includes('POSVEN_MAX_BACKUP_BYTES'));
});

test('restore exige autenticar antes de leer el payload de respaldo', () => {
  const postStart = backupRoute.indexOf('export async function POST(request: Request)');
  const postSection = backupRoute.slice(postStart);
  const authIndex = postSection.indexOf('await requireAdmin(request)');
  const bodyReadIndex = postSection.indexOf('await readJsonBody(request)');
  assert.ok(authIndex >= 0, 'POST debe autenticar y autorizar');
  assert.ok(bodyReadIndex > authIndex, 'el cuerpo grande no debe leerse antes de autenticar');
});

test('respuesta de restauración y cookie de sesión no permiten caché ni CSRF lax', () => {
  const postStart = backupRoute.indexOf('export async function POST(request: Request)');
  const postSection = backupRoute.slice(postStart);
  assert.ok(postSection.includes("'Cache-Control': 'no-store'"));
  assert.ok(postSection.includes("sameSite: 'strict'"));
});
