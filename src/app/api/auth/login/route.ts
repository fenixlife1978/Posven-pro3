import { NextResponse } from 'next/server';
import { createSession, ensureSeedAdmin, getUserWithSecret, verifyPassword } from '@/lib/auth/turso-auth';
import { isTursoConfigured } from '@/lib/turso/client';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    if (!isTursoConfigured()) return NextResponse.json({ error: 'Turso no está configurado.' }, { status: 503 });

    const body = await request.json().catch(() => ({}));
    const identifier = String(body?.identifier || '').trim();
    const password = String(body?.password || '');
    const role = String(body?.role || '');

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Usuario/correo y contraseña son obligatorios.' }, { status: 400 });
    }

    await ensureSeedAdmin();

    const row = await getUserWithSecret(identifier);
    if (!row || Number(row.acceso_bloqueado || 0) === 1 || !verifyPassword(password, String(row.password_hash))) {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
    }

    if (role && role !== String(row.rol)) {
      return NextResponse.json({ error: `Usted está registrado como ${String(row.rol).toUpperCase()}.` }, { status: 403 });
    }

    const session = await createSession(String(row.id));
    const response = NextResponse.json({
      user: {
        id: row.id,
        firebaseUid: row.firebase_uid ?? null,
        username: row.username,
        email: row.email,
        nombre: row.nombre,
        rol: row.rol,
      },
      sessionId: session.id,
    });

    response.cookies.set('posven_session', session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: new Date(session.expires),
    });

    return response;
  } catch (error: any) {
    console.error('[auth/login]', error);
    return NextResponse.json({ error: error?.message || 'No fue posible iniciar sesión.' }, { status: 500 });
  }
}
