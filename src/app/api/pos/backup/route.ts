import { NextResponse } from 'next/server';
import path from 'node:path';
import { createSession, getRequestSessionId, getSessionUser } from '@/lib/sqlite/auth';
import { assertSQLiteReady, exportBackupSnapshot, restoreBackupTransaction } from '@/lib/sqlite/pos-store';
import { createSqliteBackup, getSqliteDatabasePath } from '@/lib/sqlite/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readJsonBody(request: Request) {
  if (!request.body) throw Object.assign(new Error('El cuerpo de la solicitud está vacío.'), { status: 400 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const payload = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(payload));
}

async function requireAdmin(request: Request) {
  assertSQLiteReady();
  const user = await getSessionUser(getRequestSessionId(request));
  if (!user) throw Object.assign(new Error('No autenticado.'), { status: 401 });
  if (user.rol !== 'administrador') throw Object.assign(new Error('Se requiere administrador.'), { status: 403 });
  return user;
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const backup = await exportBackupSnapshot();
    return NextResponse.json({ ok: true, backup }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    const message = String(error?.message || error);
    const status = Number(error?.status) || (message.includes('No autenticado') ? 401 : message.includes('Se requiere administrador') ? 403 : 400);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    // Autenticar y autorizar ANTES de consumir el cuerpo potencialmente grande.
    // Esto evita que solicitudes anónimas/no autorizadas fuerzan lectura y
    // acumulación de respaldos en memoria.
    const user = await requireAdmin(request);
    const body = await readJsonBody(request);
    if (String(body?.action || '') !== 'restore') {
      throw Object.assign(new Error('La restauración debe enviarse como un único paquete validado.'), { status: 400 });
    }
    const backup = body?.backup;
    if (!backup || backup.app !== 'posven-pro' || !backup.data || typeof backup.data !== 'object') {
      throw Object.assign(new Error('El archivo no es un respaldo POSVEN válido.'), { status: 400 });
    }

    const databasePath = getSqliteDatabasePath();
    const backupDirectory = path.join(path.dirname(databasePath), 'backups');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safetyCopy = path.join(backupDirectory, 'antes-restauracion-' + timestamp + '.sqlite');
    await createSqliteBackup(safetyCopy);

    const result = await restoreBackupTransaction({ user, backup });
    const session = await createSession(String(result.preservedAdminId));
    const response = NextResponse.json({
      ok: true,
      action: 'restore',
      sessionId: session.id,
      preservedAdmin: result.preservedAdmin,
      importedUsers: result.importedUsers,
      skippedUsers: result.skippedUsers,
      temporaryCredentials: result.temporaryCredentials,
      totalRows: result.totalRows,
      counts: result.counts,
      safetyBackupCreated: true,
    });
    response.cookies.set('posven_session', session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      expires: new Date(session.expires),
    });
    return response;
  } catch (error: any) {
    const message = String(error?.message || error);
    const status = Number(error?.status) || (
      message.includes('No autenticado') ? 401 :
      message.includes('Se requiere administrador') ? 403 : 400
    );
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
