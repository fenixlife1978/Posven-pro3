import { NextRequest, NextResponse } from 'next/server';
import { createUser, getSessionUser, listUsers } from '@/lib/auth/turso-auth';

export const runtime = 'nodejs';

async function admin(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get('posven_session')?.value);
  if (!user || user.rol !== 'administrador') return null;
  return user;
}

export async function GET(request: NextRequest) {
  const user = await admin(request);
  if (!user) return NextResponse.json({ error: 'Acceso administrativo requerido.' }, { status: 403 });
  return NextResponse.json({ usuarios: await listUsers() });
}

export async function POST(request: NextRequest) {
  const user = await admin(request);
  if (!user) return NextResponse.json({ error: 'Acceso administrativo requerido.' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({}));
    const created = await createUser({
      username: String(body?.username || body?.email || '').trim(),
      email: body?.email ? String(body.email) : undefined,
      nombre: String(body?.nombre || '').trim(),
      password: String(body?.password || ''),
      rol: body?.rol === 'administrador' ? 'administrador' : 'cajero',
    });
    return NextResponse.json({ usuario: created }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'No fue posible crear el usuario.' }, { status: 400 });
  }
}
