import { NextResponse } from 'next/server';
import { getRequestSessionId, getSessionUser } from '@/lib/auth/turso-auth';
import { getDemoUsage } from '@/lib/demo-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(getRequestSessionId(request));
    if (!user) return NextResponse.json({ ok: false, error: 'No autenticado.' }, { status: 401 });
    return NextResponse.json({ ok: true, ...await getDemoUsage() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}
