import { NextResponse } from 'next/server';
import { clearLoginAttempts, consumeLoginAttempt, createSession, ensureSeedAdmin, getUserWithSecret, verifyPassword } from '@/lib/sqlite/auth';
import { isSQLiteConfigured } from '@/lib/sqlite/client';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    if (!isSQLiteConfigured()) return NextResponse.json({ error: 'SQLite local no está disponible.' }, { status: 503 });

    const body = await request.json().catch(() => ({}));
    const identifier = String(body?.identifier || '').trim();
    const password = String(body?.password || '');
    const role = String(body?.role || '');

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Usuario/correo y contraseña son obligatorios.' }, { status: 400 });
    }

    await ensureSeedAdmin();

    // La IP se usa solo como ámbito de rate limit; SQLite conserva únicamente su hash.
    const forwardedOrigin = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
    const sourceOrigin = forwardedOrigin || request.headers.get('x-real-ip')?.trim() || 'unknown';
    const attempt = await consumeLoginAttempt(identifier, sourceOrigin);
    if (!attempt.allowed) {
      return NextResponse.json(
        { error: 'Demasiados intentos de inicio de sesión. Espere antes de volver a intentar.' },
        { status: 429, headers: { 'Retry-After': String(attempt.retryAfterSeconds) } },
      );
    }

    const row = await getUserWithSecret(identifier);
    if (!row || Number(row.acceso_bloqueado || 0) === 1 || !verifyPassword(password, String(row.password_hash))) {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
    }

    await clearLoginAttempts(identifier, sourceOrigin);

    if (role && role !== String(row.rol)) {
      return NextResponse.json({ error: `Usted está registrado como ${String(row.rol).toUpperCase()}.` }, { status: 403 });
    }

    const session = await createSession(String(row.id));
    const response = NextResponse.json({
      user: {
        id: row.id,
        username: row.username,
        email: row.email,
        nombre: row.nombre,
        rol: row.rol,
      },
      sessionId: session.id,
    });

    response.cookies.set('posven_session', session.id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      expires: new Date(session.expires),
    });

    return response;
  } catch (error: any) {
    console.error('[auth/login]', error);
    return NextResponse.json({ error: error?.message || 'No fue posible iniciar sesión.' }, { status: 500 });
  }
}
