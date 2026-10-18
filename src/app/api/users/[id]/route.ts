import { NextRequest, NextResponse } from 'next/server';
import { deleteUser, getSessionUser, setUserBlocked } from '@/lib/auth/turso-auth';
import { tursoExecute } from '@/lib/turso/client';

export const runtime = 'nodejs';

async function admin(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get('posven_session')?.value);
  if (!user || user.rol !== 'administrador') return null;
  return user;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await admin(request);
  if (!user) return NextResponse.json({ error: 'Acceso administrativo requerido.' }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const target = await tursoExecute({
    sql: 'SELECT is_seed_admin, nombre, rol, acceso_bloqueado FROM users WHERE id=? LIMIT 1',
    args: [id],
  });
  if (!target.rows[0]) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });

  const hasBlockChange = typeof body?.accesoBloqueado === 'boolean';

  if (hasBlockChange) {
    try {
      await setUserBlocked(id, Boolean(body.accesoBloqueado));
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'No fue posible cambiar el estado del usuario.' }, { status: 400 });
    }
  }

  const nombre = body?.nombre === undefined ? String(target.rows[0].nombre || '') : String(body.nombre || '').trim();
  const rol = body?.rol === undefined ? String(target.rows[0].rol || '') : String(body.rol || '');
  if (!nombre || !['administrador', 'cajero'].includes(rol)) {
    return NextResponse.json({ error: 'Datos de usuario inválidos.' }, { status: 400 });
  }
  if (Number(target.rows[0].is_seed_admin) === 1 && rol !== 'administrador') {
    return NextResponse.json({ error: 'El administrador semilla debe conservar el rol administrador.' }, { status: 400 });
  }

  await tursoExecute({
    sql: 'UPDATE users SET nombre=?, rol=? WHERE id=?',
    args: [nombre, rol, id],
    wantRows: false,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await admin(request);
  if (!user) return NextResponse.json({ error: 'Acceso administrativo requerido.' }, { status: 403 });
  try {
    const { id } = await context.params;
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'No fue posible eliminar el usuario.' }, { status: 400 });
  }
}
