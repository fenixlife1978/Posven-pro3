import { NextResponse } from 'next/server';
import { createFirstAdministrator, createSession, needsFirstAdministrator } from '@/lib/sqlite/auth';
import { isSQLiteConfigured } from '@/lib/sqlite/client';

export const runtime = 'nodejs';

export async function GET() {
  try {
    if (!isSQLiteConfigured()) {
      return NextResponse.json({ ready: false, needsSetup: false, error: 'SQLite local no está disponible.' }, { status: 503 });
    }
    const needsSetup = await needsFirstAdministrator();
    return NextResponse.json({ ready: true, needsSetup }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('[auth/setup:status]', error);
    return NextResponse.json({ ready: false, needsSetup: false, error: 'No fue posible comprobar la configuración inicial.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isSQLiteConfigured()) return NextResponse.json({ error: 'SQLite local no está disponible.' }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const username = String(body?.username || '');
    const email = String(body?.email || '');
    const nombre = String(body?.nombre || '');
    const password = String(body?.password || '');
    const confirmation = String(body?.confirmation || '');
    if (password !== confirmation) {
      return NextResponse.json({ error: 'Las contraseñas no coinciden.' }, { status: 400 });
    }
    const user = await createFirstAdministrator({ username, email, nombre, password });
    const session = await createSession(user.id);
    const response = NextResponse.json({
      created: true,
      user: { id: user.id, username: user.username, email: user.email, nombre: user.nombre, rol: user.rol },
      sessionId: session.id,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set('posven_session', session.id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      expires: new Date(session.expires),
    });
    return response;
  } catch (error: any) {
    const message = String(error?.message || 'No fue posible crear el administrador.');
    const status = /ya fue configurado|UNIQUE constraint/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
