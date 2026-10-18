import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/auth/turso-auth';
import { isTursoConfigured } from '@/lib/turso/client';
import { repararDeudasMigradas } from '@/lib/turso/cxc-repair';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isTursoConfigured()) {
    return NextResponse.json({ error: 'Turso no está configurado.' }, { status: 503 });
  }

  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get('posven_session')?.value);
  if (!user || user.rol !== 'administrador') {
    return NextResponse.json({ error: 'Se requiere un administrador Turso.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    if (body?.confirm !== 'REPARAR_CXC_MIGRADO') {
      return NextResponse.json({ error: 'Falta confirmación explícita REPARAR_CXC_MIGRADO.' }, { status: 400 });
    }
    const result = await repararDeudasMigradas();
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'No se pudo ejecutar la reparación CxC.' }, { status: 400 });
  }
}
