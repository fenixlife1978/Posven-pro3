'use client';

export interface BackupFile {
  app: 'posven-pro';
  version: number;
  createdAt: string;
  data: Record<string, unknown>;
  meta?: {
    sqliteTables?: Record<string, number>;
    tursoTables?: Record<string, number>;
    catalogs?: Record<string, number>;
    source?: string;
    complete?: boolean;
  };
}

export async function crearRespaldo(): Promise<BackupFile> {
  const response = await fetch('/api/pos/backup', {
    credentials: 'include',
    cache: 'no-store',
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || body?.backup?.app !== 'posven-pro') {
    throw new Error(body?.error || 'No se pudo generar un respaldo SQLite consistente.');
  }
  return body.backup as BackupFile;
}

export function descargarRespaldo(backup: BackupFile) {
  const nombre = 'Respaldo_POSVEN_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function leerArchivoRespaldo(file: File): Promise<BackupFile | null> {
  if (!file) return null;
  const text = await file.text();
  const parsed = JSON.parse(text) as BackupFile;
  if (!parsed || parsed.app !== 'posven-pro' || typeof parsed.data !== 'object') {
    throw new Error('El archivo no es un respaldo válido de POSVEN-Pro.');
  }
  return parsed;
}

export interface CatalogsOnlyImportResult {
  ok: true;
  action: 'preview' | 'import';
  plan: Record<'departamentos' | 'categorias', {
    before: number;
    imported: number;
    added: number;
    duplicates: number;
    after: number;
    values: string[];
  }>;
  catalogs: { departamentos: string[]; categorias: string[] };
}

async function postCatalogsOnlyImport(file: File, action: 'preview' | 'import'): Promise<CatalogsOnlyImportResult> {
  if (!file || file.size > 1024 * 1024) throw new Error('Seleccione un JSON de catálogos de máximo 1 MB.');
  let parsed: any;
  try { parsed = JSON.parse(await file.text()); }
  catch { throw new Error('El archivo de catálogos no contiene JSON válido.'); }
  if (!parsed || parsed.app !== 'posven-pro' || parsed.type !== 'catalogs-only' ||
      !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new Error('El archivo no es el JSON exclusivo de catálogos POSVEN.');
  }
  const keys = Object.keys(parsed.data).sort();
  if (keys.length !== 2 || keys[0] !== 'categorias' || keys[1] !== 'departamentos') {
    throw new Error('El archivo debe contener únicamente departamentos y categorías.');
  }
  for (const name of ['departamentos', 'categorias'] as const) {
    const values = parsed.data[name];
    if (!Array.isArray(values) || values.some((value: unknown) =>
      typeof value !== 'string' || !value.trim() || value.length > 120
    )) throw new Error('El catálogo ' + name + ' contiene datos inválidos.');
  }

  const response = await fetch('/api/pos/catalogs-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify({
      action,
      backup: parsed,
      ...(action === 'import' ? { confirmation: 'IMPORTAR_SOLO_CATALOGOS' } : {}),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.error || 'No se pudo procesar el archivo de catálogos.');
  }
  return body as CatalogsOnlyImportResult;
}

export function previsualizarCatalogosDesdeArchivo(file: File): Promise<CatalogsOnlyImportResult> {
  return postCatalogsOnlyImport(file, 'preview');
}

export function importarCatalogosDesdeArchivo(file: File): Promise<CatalogsOnlyImportResult> {
  return postCatalogsOnlyImport(file, 'import');
}

function descargarCredencialesRestauradas(credentials: Array<{ username: string; password: string; rol: string }>) {
  if (!credentials.length) return;
  const lines = [
    'POSVEN3 - CREDENCIALES TEMPORALES DE USUARIOS RESTAURADOS',
    'Estas contraseñas se generaron porque POSVEN2 no incluye hashes de contraseña en sus respaldos.',
    'Entregue cada clave al usuario correspondiente y solicite cambiarla después del primer acceso.',
    'Guarde este archivo de forma privada y elimínelo cuando haya entregado las claves.',
    '',
    'Usuario | Rol | Contraseña temporal',
    ...credentials.map(item => item.username + ' | ' + item.rol + ' | ' + item.password),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'POSVEN3_credenciales_temporales_restauracion.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * La cantidad de registros NO se usa como señal de truncamiento: un respaldo
 * con 10.000, 50.000 o más ventas y movimientos es válido y debe restaurarse
 * completo. Solo el manifiesto puede declarar de forma explícita que la
 * exportación quedó incompleta (complete: false).
 */
export function detectarRespaldoTursoTruncado(backup: BackupFile): { incompleteManifest: boolean; oldestMovementDate: string | null; movementCount: number } {
  const movements = Array.isArray(backup?.data?.movimientos) ? backup.data.movimientos as any[] : [];
  const dates = movements
    .map(row => String(row?.fecha || row?.createdAt || row?.fechaMovimiento || '').slice(0, 10))
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  return {
    incompleteManifest: backup?.meta?.complete === false,
    oldestMovementDate: dates[0] || null,
    movementCount: movements.length,
  };
}

export function validarRespaldoParaRestauracion(backup: BackupFile, allowPartialTursoRestore = false): void {
  const { incompleteManifest } = detectarRespaldoTursoTruncado(backup);
  if (incompleteManifest && !allowPartialTursoRestore) {
    throw new Error(
      'El respaldo declara un manifiesto incompleto (complete: false). ' +
      'POSVEN-Pro3 detuvo la carga antes de enviar el archivo. ' +
      'La restauración requiere confirmación explícita del administrador. ' +
      'La cantidad de ventas o movimientos del archivo no es la causa.'
    );
  }
}

async function restaurarBackupLocal(
  backup: BackupFile,
  onProgress?: (progress: { percent: number; stage: string; detail: string }) => void,
  allowPartialTursoRestore = false,
): Promise<void> {
  validarRespaldoParaRestauracion(backup, allowPartialTursoRestore);
  onProgress?.({ percent: 8, stage: 'Preparando', detail: 'Validando respaldo y preparando el envío…' });
  const payload = JSON.stringify({ action: 'restore', backup, confirmPartialTursoRestore: allowPartialTursoRestore });
  const body: any = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/pos/backup', true);
    xhr.withCredentials = true;
    // Sin límite de tiempo: restaurar un respaldo grande puede tardar y el
    // tamaño del archivo no debe provocar un aborto por temporizador.
    xhr.timeout = 0;
    xhr.setRequestHeader('Content-Type', 'application/json');
    // Mantiene el mismo contexto de sesión que el wrapper global de fetch.
    try {
      const sessionId = sessionStorage.getItem('posven_session_id');
      xhr.setRequestHeader('x-posven-session-mode', 'tab');
      if (sessionId) xhr.setRequestHeader('x-posven-session', sessionId);
    } catch {}
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.min(35, 8 + Math.round((event.loaded / event.total) * 27));
      onProgress?.({ percent, stage: 'Enviando respaldo', detail: 'Enviados ' + (event.loaded / 1024 / 1024).toFixed(1) + ' de ' + (event.total / 1024 / 1024).toFixed(1) + ' MB.' });
    };
    xhr.upload.onload = () => {
      onProgress?.({ percent: 40, stage: 'Procesando en SQLite', detail: 'Archivo recibido. Validando datos, creando copia de seguridad y restaurando la base de datos. Este proceso puede tardar; no cierre la aplicación.' });
    };
    xhr.onload = () => {
      let parsed: any = {};
      try { parsed = xhr.responseText ? JSON.parse(xhr.responseText) : {}; }
      catch { reject(new Error(xhr.responseText || 'El servidor devolvió una respuesta no válida.')); return; }
      if (xhr.status < 200 || xhr.status >= 300 || parsed?.ok === false) {
        reject(new Error(parsed?.error || ('Error HTTP ' + xhr.status + ' al restaurar el respaldo.')));
        return;
      }
      resolve(parsed);
    };
    xhr.onerror = () => reject(new Error('Se perdió la conexión con el servidor local durante la restauración. Compruebe el estado de la base de datos antes de volver a intentarlo.'));
    xhr.ontimeout = () => reject(new Error('La restauración superó el límite de tiempo configurado. No vuelva a intentarlo a ciegas: compruebe primero si la base de datos fue restaurada y conserve la copia de seguridad automática.'));
    xhr.onabort = () => reject(new Error('La solicitud de restauración fue cancelada.'));
    xhr.send(payload);
  });
  onProgress?.({ percent: 92, stage: 'Verificando resultado', detail: 'SQLite confirmó la restauración. Verificando la respuesta y preparando el acceso…' });
  if (body.sessionId && typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('posven_session_id', String(body.sessionId));
  }
  descargarCredencialesRestauradas(Array.isArray(body.temporaryCredentials) ? body.temporaryCredentials : []);
  onProgress?.({ percent: 100, stage: 'Completado', detail: 'Restauración SQLite completada. Se conservó el administrador local: ' + String(body.preservedAdmin || 'admin') + '. Usuarios recuperados: ' + Number(body.importedUsers || 0) + '. Claves temporales generadas: ' + (Array.isArray(body.temporaryCredentials) ? body.temporaryCredentials.length : 0) + '.' });
}

export async function restaurarRespaldo(backup: BackupFile): Promise<void> {
  await restaurarBackupLocal(backup);
}

export async function cargarRespaldoDesdeContenido(
  content: string,
  onProgress?: (progress: { percent: number; stage: string; detail: string }) => void,
  allowPartialTursoRestore = false,
): Promise<void> {
  if (!content) {
    throw new Error('El respaldo está vacío.');
  }
  let backup: BackupFile;
  try {
    backup = JSON.parse(content) as BackupFile;
  } catch {
    throw new Error('El archivo seleccionado no contiene JSON válido.');
  }
  if (!backup || backup.app !== 'posven-pro' || !backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
    throw new Error('El archivo no es un respaldo válido de POSVEN-Pro.');
  }
  await restaurarBackupLocal(backup, onProgress, allowPartialTursoRestore);
}

export async function cargarRespaldoDesdeArchivo(
  file: File,
  onProgress?: (progress: { percent: number; stage: string; detail: string }) => void,
): Promise<void> {
  if (!file) return;
  await cargarRespaldoDesdeContenido(await file.text(), onProgress);
}
