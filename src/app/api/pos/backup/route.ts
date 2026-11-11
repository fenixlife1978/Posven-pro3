import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import path from 'node:path';
import { createSession, getSessionUser } from '@/lib/sqlite/auth';
import { assertSQLiteReady, exportBackupSnapshot, restoreBackupTransaction } from '@/lib/sqlite/pos-store';
import { createSqliteBackup, getSqliteDatabasePath } from '@/lib/sqlite/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin() {
  assertSQLiteReady();
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get('posven_session')?.value);
  if (!user) throw Object.assign(new Error('No autenticado.'), { status: 401 });
  if (user.rol !== 'administrador') throw Object.assign(new Error('Se requiere administrador.'), { status: 403 });
  return user;
}

export async function GET() {
  try {
    await requireAdmin();
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
    const user = await requireAdmin();
    const body = await request.json();
    if (String(body?.action || '') !== 'restore') {
      throw Object.assign(new Error('La restauración debe enviarse como un único paquete validado.'), { status: 400 });
    }
    const backup = body?.backup;
    if (!backup || backup.app !== 'posven-pro' || !backup.data || typeof backup.data !== 'object') {
      throw Object.assign(new Error('El archivo no es un respaldo POSVEN válido.'), { status: 400 });
    }
    if (JSON.stringify(backup).length > 64 * 1024 * 1024) {
      throw Object.assign(new Error('El respaldo supera el tamaño máximo permitido de 64 MB.'), { status: 413 });
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
