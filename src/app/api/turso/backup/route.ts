import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSession, getSessionUser } from '@/lib/auth/turso-auth';
import {
  assertTursoReady,
  factoryResetTransaction,
  upsertRecords,
  patchAppConfig,
  patchCatalog,
  type TursoStoreTable,
} from '@/lib/turso/pos-store';

export const runtime = 'nodejs';

const TABLES = [
  'productos','movimientos','ventas','cxc','cxp','clientes','proveedores',
  'devoluciones','anulaciones','terminales','libroDiario','reportesZ','caja','compras',
] as const;

const CATALOGS = [
  'categorias','departamentos','marcas','presentaciones',
  'productCategories','productUnits','productColors','productSizes',
  'brands','groups','subgroups','lines','suppliers',
] as const;

type TableName = typeof TABLES[number];
type CatalogName = typeof CATALOGS[number];

async function requireAdmin() {
  assertTursoReady();
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get('posven_session')?.value);
  if (!user) throw Object.assign(new Error('No autenticado.'), { status: 401 });
  if (user.rol !== 'administrador') throw Object.assign(new Error('Se requiere administrador.'), { status: 403 });
  return user;
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const action = String(body?.action || '');

    if (action === 'reset') {
      const result = await factoryResetTransaction({ user });
      // El reset elimina las sesiones para limpiar completamente la base de datos.
      // Debemos crear inmediatamente una nueva sesión para que los siguientes
      // bloques del respaldo sigan autenticados sin obligar al usuario a volver a entrar.
      const session = await createSession(String(result.seedAdmin.id));
      const response = NextResponse.json({ ok: true, action, ...result });
      response.cookies.set('posven_session', session.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        expires: new Date(session.expires),
      });
      return response;
    }

    if (action === 'table') {
      const table = String(body?.table || '') as TableName;
      if (!TABLES.includes(table)) throw new Error('Tabla de respaldo no permitida.');
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      if (rows.length > 450) throw new Error('El lote supera el límite seguro de 450 registros.');
      const result = await upsertRecords(table as TursoStoreTable, rows);
      return NextResponse.json({ ok: true, action, table, count: result.count });
    }

    if (action === 'catalog') {
      const name = String(body?.name || '') as CatalogName;
      if (!CATALOGS.includes(name)) throw new Error('Catálogo de respaldo no permitido.');
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      await patchCatalog(name, rows);
      return NextResponse.json({ ok: true, action, name, count: rows.length });
    }

    if (action === 'config') {
      const config = body?.config;
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Configuración de respaldo inválida.');
      }
      await patchAppConfig(config);
      return NextResponse.json({ ok: true, action });
    }

    if (action === 'finish') {
      return NextResponse.json({
        ok: true,
        action,
        skipped: ['users','operaciones','auditoriaSistema','legacy_documents','rtdb_productos'],
        note: 'Se conserva el administrador semilla de Turso.',
      });
    }

    throw new Error('Acción de restauración no reconocida.');
  } catch (error: any) {
    const message = String(error?.message || error);
    const status = Number(error?.status) || (
      message.includes('no está configurado') ? 503 :
      message.includes('No autenticado') ? 401 :
      message.includes('Se requiere administrador') ? 403 : 400
    );
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
