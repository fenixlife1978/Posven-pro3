'use client';

export interface BackupFile {
  app: 'posven-pro';
  version: number;
  createdAt: string;
  data: Record<string, unknown>;
  meta?: {
    sqliteTables: Record<string, number>;
    catalogs: Record<string, number>;
    source: 'sqlite-local';
    complete: true;
  };
}

export async function crearRespaldo(): Promise<BackupFile> {
  const response = await fetch('/api/pos/backup', {
    credentials: 'include',
    cache: 'no-store',
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

async function restaurarBackupLocal(
  backup: BackupFile,
  onProgress?: (progress: { percent: number; stage: string; detail: string }) => void,
): Promise<void> {
  onProgress?.({ percent: 5, stage: 'Preparando', detail: 'Validando respaldo y preparando copia de seguridad local…' });
  const response = await fetch('/api/pos/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify({ action: 'restore', backup }),
  });
  const raw = await response.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { error: raw || 'Respuesta no válida.' }; }
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || ('Error HTTP ' + response.status + ' al restaurar el respaldo.'));
  }
  descargarCredencialesRestauradas(Array.isArray(body.temporaryCredentials) ? body.temporaryCredentials : []);
  onProgress?.({ percent: 100, stage: 'Completado', detail: 'Restauración SQLite completada. Se conservó el administrador local: ' + String(body.preservedAdmin || 'admin') + '. Usuarios recuperados: ' + Number(body.importedUsers || 0) + '. Claves temporales generadas: ' + (Array.isArray(body.temporaryCredentials) ? body.temporaryCredentials.length : 0) + '.' });
}

export async function restaurarRespaldo(backup: BackupFile): Promise<void> {
  await restaurarBackupLocal(backup);
}

export async function cargarRespaldoDesdeArchivo(
  file: File,
  onProgress?: (progress: { percent: number; stage: string; detail: string }) => void,
): Promise<void> {
  const backup = await leerArchivoRespaldo(file);
  if (!backup) return;
  await restaurarBackupLocal(backup, onProgress);
}
