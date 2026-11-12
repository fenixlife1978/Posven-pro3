import { NextRequest, NextResponse } from 'next/server';
import { getRequestSessionId, revokeSession } from '@/lib/sqlite/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await revokeSession(getRequestSessionId(request));
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
