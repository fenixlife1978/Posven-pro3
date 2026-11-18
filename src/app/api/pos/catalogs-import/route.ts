import { NextResponse } from 'next/server';
import { getRequestSessionId, getSessionUser } from '@/lib/sqlite/auth';
import {
  assertSQLiteReady,
  mergeCatalogsOnlyImportTransaction,
  previewCatalogsOnlyImport,
} from '@/lib/sqlite/pos-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertSQLiteReady();
    const user = await getSessionUser(getRequestSessionId(request));
    if (!user) throw Object.assign(new Error('No autenticado.'), { status: 401 });
    if (user.rol !== 'administrador') throw Object.assign(new Error('Se requiere administrador.'), { status: 403 });

    const contentLength = Number(request.headers.get('content-length') || 0);\n    if (contentLength > 1024 * 1024 + 16 * 1024) {\n      throw Object.assign(new Error('El archivo de catálogos supera el límite técnico de 1 MB.'), { status: 413 });\n    }\n\n    const body = await request.json();
    const backup = body?.backup;
    if (!backup || backup.app !== 'posven-pro' || backup.type !== 'catalogs-only' ||
        !backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
      throw Object.assign(new Error('El archivo no es un JSON exclusivo de catálogos POSVEN.'), { status: 400 });
    }

    const action = String(body?.action || '');
    if (action === 'preview') {
      const result = await previewCatalogsOnlyImport(backup.data);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'import') {
      if (body?.confirmation !== 'IMPORTAR_SOLO_CATALOGOS') {
        throw Object.assign(new Error('La importación requiere confirmación explícita.'), { status: 400 });
      }
      const result = await mergeCatalogsOnlyImportTransaction(backup.data);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    throw Object.assign(new Error('Acción de catálogos no válida.'), { status: 400 });
  } catch (error: any) {
    const message = String(error?.message || error);
    const status = Number(error?.status) || (
      message.includes('No autenticado') ? 401 :
      message.includes('Se requiere administrador') ? 403 : 400
    );
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
