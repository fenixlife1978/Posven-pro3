import { NextRequest, NextResponse } from 'next/server';
import { getRequestSessionId, getSessionUser } from '@/lib/auth/turso-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser(getRequestSessionId(request));
    if (!user) return NextResponse.json({ authenticated: false }, { status: 401 });
    return NextResponse.json({ authenticated: true, user });
  } catch (error: any) {
    console.error('[auth/session]', error);
    return NextResponse.json({ authenticated: false, error: error?.message || 'Error de sesión.' }, { status: 500 });
  }
}
