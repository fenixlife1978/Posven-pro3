import { NextRequest, NextResponse } from 'next/server';
import { deleteUser, getRequestSessionId, getSessionUser, updateUser } from '@/lib/sqlite/auth';

export const runtime = 'nodejs';

async function admin(request: NextRequest) {
  const user = await getSessionUser(getRequestSessionId(request));
  if (!user || user.rol !== 'administrador') return null;
  return user;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await admin(request);
  if (!user) return NextResponse.json({ error: 'Acceso administrativo requerido.' }, { status: 403 });

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const input: { id: string; nombre?: string; rol?: 'administrador' | 'cajero'; accesoBloqueado?: boolean } = { id };
    if (body?.nombre !== undefined) input.nombre = String(body.nombre);
    if (body?.rol !== undefined) {
      const role = String(body.rol);
      if (role !== 'administrador' && role !== 'cajero') {
        return NextResponse.json({ error: 'Datos de usuario inválidos.' }, { status: 400 });
      }
      input.rol = role;
    }
    if (body?.accesoBloqueado !== undefined) {
      if (typeof body.accesoBloqueado !== 'boolean') {
        return NextResponse.json({ error: 'El estado de bloqueo debe ser verdadero o falso.' }, { status: 400 });
      }
      input.accesoBloqueado = body.accesoBloqueado;
    }
    await updateUser(input);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const message = String(error?.message || 'No fue posible actualizar el usuario.');
    const status = message === 'Usuario no encontrado.' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
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
