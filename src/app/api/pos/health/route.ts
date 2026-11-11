import { NextResponse } from 'next/server';
import { ensureSqliteSchema } from '@/lib/sqlite/schema-init';
import { sqliteHealthCheck } from '@/lib/sqlite/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureSqliteSchema();
    const health = sqliteHealthCheck();
    if (!health.ok) return NextResponse.json({ ok: false, database: 'sqlite', integrity: health.integrity }, { status: 503 });
    return NextResponse.json({
      ok: true,
      database: 'sqlite',
      journalMode: health.journalMode,
      foreignKeys: health.foreignKeys,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, database: 'sqlite', error: error?.message || 'SQLite no disponible.' }, { status: 503 });
  }
}
