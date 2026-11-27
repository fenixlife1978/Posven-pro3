import { NextRequest, NextResponse } from 'next/server';
import { getRequestSessionId, revokeSession } from '@/lib/sqlite/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await revokeSession(getRequestSessionId(request));
  } catch (error: any) {
    // Un fallo de SQLite no debe impedir que el cliente cierre su sesión:
    // la cookie se elimina siempre y el error queda registrado para revisión.
    console.error('[auth/logout] No se pudo revocar la sesión en SQLite:', error);
  } finally {
    const response = NextResponse.json({ ok: true });
    response.cookies.set('posven_session', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: 0,
    });
    return response;
  }
}
