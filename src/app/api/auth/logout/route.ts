import { NextRequest, NextResponse } from 'next/server';
import { getRequestSessionId, revokeSession } from '@/lib/auth/turso-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await revokeSession(getRequestSessionId(request));
  } finally {
    const response = NextResponse.json({ ok: true });
    response.cookies.set('posven_session', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    });
    return response;
  }
}
