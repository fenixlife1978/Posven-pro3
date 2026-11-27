import { NextResponse } from 'next/server';
import { getRequestSessionId, getSessionUser } from '@/lib/sqlite/auth';
import { isSQLiteConfigured } from '@/lib/sqlite/client';
import { repararDeudasMigradas } from '@/lib/sqlite/cxc-repair';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSQLiteConfigured()) return NextResponse.json({ error: 'SQLite local no está disponible.' }, { status: 503 });
  // Misma resolución de sesión que /api/pos/store: cookie o cabecera de
  // sesión por pestaña (x-posven-session-mode: tab), sin identidades cruzadas.
  const user = await getSessionUser(getRequestSessionId(request));
  if (!user || user.rol !== 'administrador') return NextResponse.json({ error: 'Se requiere un administrador.' }, { status: 403 });
  try {
    const body = await request.json();
    if (body?.confirm !== 'REPARAR_CXC_MIGRADO') return NextResponse.json({ error: 'Falta confirmación explícita REPARAR_CXC_MIGRADO.' }, { status: 400 });
    const result = await repararDeudasMigradas();
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'No se pudo ejecutar la reparación CxC.' }, { status: 400 });
  }
}
