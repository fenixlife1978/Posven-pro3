import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    demo: process.env.POSVEN_DEMO_BUILD === '1',
    desktop: process.env.POSVEN_DESKTOP_BUILD === '1',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
