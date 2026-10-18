/**
 * Repositorio POSVEN sobre Turso.
 *
 * Exclusivamente servidor. Turso es la única base de datos operativa.
 * Las operaciones críticas usan transacciones interactivas.
 */
import {
  isTursoConfigured,
  tursoExecute,
  tursoInteractiveTransaction,
  type TursoStatement,
} from './client';

const TABLES = {
  productos: 'productos',
  movimientos: 'movimientos',
  ventas: 'ventas',
  cxc: 'cxc',
  cxp: 'cxp',
  clientes: 'clientes',
  proveedores: 'proveedores',
  devoluciones: 'devoluciones',
  anulaciones: 'anulaciones',
  terminales: 'terminales',
  libroDiario: 'libro_diario',
  reportesZ: 'reportes_z',
  caja: 'caja',
  compras: 'compras',
} as const;

export type TursoStoreTable = keyof typeof TABLES;

// Catálogos base de supermercado. Se agregan de forma idempotente: nunca
// sustituyen las opciones personalizadas que ya existan en Turso.
export const DEFAULT_DEPARTAMENTOS = [
  'Frutas y Verduras',
  'Carnicería y Charcutería',
  'Lácteos y Refrigerados',
  'Víveres y Abarrotes',
  'Condimentos y Especias',
  'Panadería y Galletas',
  'Bebidas',
  'Snacks y Golosinas',
  'Cuidado del Hogar y Limpieza',
  'Cuidado Personal e Higiene',
];

export const DEFAULT_CATEGORIAS = [
  'Verduras y Hortalizas', 'Frutas Frescas', 'Hierbas y Aromáticas', 'Tubérculos y Raíces',
  'Carne de Res', 'Aves', 'Cerdo', 'Embutidos y Charcutería', 'Pescados y Mariscos',
  'Leche Líquida y Derivados', 'Quesos', 'Yogures y Postres', 'Mantequillas y Margarinas', 'Huevos',
  'Granos y Legumbres', 'Arroz y Cereales', 'Pastas', 'Harinas y Mezclas', 'Aceites y Grasas', 'Salsas y Envasados',
  'Condimentos Secos', 'Caldos y Sazonadores', 'Azúcar y Endulzantes', 'Repostería y Hornear',
  'Pan Fresco y Empacado', 'Galletas Saladas', 'Galletas Dulces y Ponqués',
  'Bebidas No Alcohólicas', 'Café y Té', 'Cervezas y Maltas', 'Licores y Vinos',
  'Snacks Salados', 'Chocolates y Confitería',
  'Detergentes y Lavado', 'Limpieza de Superficies', 'Lavaplatos y Cocina', 'Utensilios y Desechables',
  'Higiene Corporal', 'Higiene Oral', 'Papel e Higiene Femenina', 'Cuidado del Bebé',
];

export function assertTursoReady() {
  if (!isTursoConfigured()) throw new Error('Turso no está configurado.');
}

function clean(value: any): any {
  if (value === undefined) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = clean(v);
    return out;
  }
  return value;
}

function rowFromDb(row: any): any {
  if (!row) return null;
  let data: any = {};
  try { data = JSON.parse(String(row.data_json || '{}')); } catch {}
  return { ...data, id: String(row.id) };
}

function tableName(table: TursoStoreTable): string {
  const name = TABLES[table];
  if (!name) throw new Error('Tabla POSVEN no permitida.');
  return name;
}

function rowStatement(table: TursoStoreTable, record: any): TursoStatement {
  const id = String(record?.id || '');
  if (!id) throw new Error('El registro no tiene id.');
  const dataJson = JSON.stringify(clean({ ...record, id }));

  // productos conserva todo su payload dentro de data_json y su esquema
  // histórico no tiene columna fecha. Las demás tablas operativas sí la usan
  // para ordenar/consultar cronológicamente.
  if (table === 'productos') {
    return {
      sql: `INSERT INTO productos(id,data_json,updated_at)
        VALUES(?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          data_json=excluded.data_json,
          updated_at=CURRENT_TIMESTAMP`,
      args: [id, dataJson],
      wantRows: false,
    };
  }

  return {
    sql: `INSERT INTO ${tableName(table)}(id,data_json,fecha,updated_at)
      VALUES(?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        data_json=excluded.data_json,
        fecha=excluded.fecha,
        updated_at=CURRENT_TIMESTAMP`,
    args: [id, dataJson, record?.fecha == null ? null : String(record.fecha)],
    wantRows: false,
  };
}

function txSelect(table: TursoStoreTable, id: string): TursoStatement {
  return {
    sql: `SELECT id,data_json FROM ${tableName(table)} WHERE id=? LIMIT 1`,
    args: [String(id)],
  };
}

function terminalPrefix(terminal: any, terminalId?: string): string {
  const raw = String(terminal?.prefijoCaja || '').trim().toUpperCase();
  if (raw) return raw;
  if (terminalId) return 'C-' + String(terminalId).replace(/[^A-Z0-9]/gi, '').slice(-6).toUpperCase();
  return 'GLOBAL';
}

// La serie visible pertenece a UNA sola caja. Si una base migrada contiene
// terminales con el mismo prefijo, no permitimos que ambas cajas compartan
// la misma serie: añadimos una parte estable del terminalId solo en ese caso.
// Así no se rompe la numeración de cajas que ya tienen prefijos únicos.
async function terminalUniquePrefix(tx: any, terminal: any, terminalId?: string): Promise<string> {
  const base = terminalPrefix(terminal, terminalId);
  if (!terminalId || base === 'GLOBAL') return base;
  const duplicate = await tx.execute({
    sql: "SELECT id FROM terminales WHERE id<>? AND json_extract(data_json,'$.prefijoCaja')=? LIMIT 1",
    args: [String(terminalId), base],
  });
  if (duplicate.rows.length) {
    return base + '-' + String(terminalId).replace(/[^A-Z0-9]/gi, '').slice(-6).toUpperCase();
  }
  return base;
}

function terminalSeries(prefix: string, label: string, number: number, width = 6) {
  return prefix + '-' + label + '-' + String(number).padStart(width, '0');
}

export async function getRecord(table: TursoStoreTable, id: string): Promise<any | null> {
  assertTursoReady();
  const result = await tursoExecute(txSelect(table, id));
  return rowFromDb(result.rows[0]);
}

export async function listRecords(
  table: TursoStoreTable,
  options: { limit?: number; offset?: number; terminalId?: string; estado?: string } = {},
): Promise<any[]> {
  assertTursoReady();
  const limit = Math.min(Math.max(Number(options.limit) || 500, 1), 10000);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const args: any[] = [];
  const filters: string[] = [];
  if (options.terminalId) {
    filters.push("json_extract(data_json,'$.terminalId')=?");
    args.push(String(options.terminalId));
  }
  if (options.estado) {
    filters.push("json_extract(data_json,'$.estado')=?");
    args.push(String(options.estado));
  }
  const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
  const orderBy = table === 'productos' ? 'updated_at DESC' : "COALESCE(fecha,'') DESC";
  const result = await tursoExecute({
    sql: `SELECT id,data_json FROM ${tableName(table)}${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
    args,
  });
  return result.rows.map(rowFromDb).filter(Boolean);
}

export async function countRecords(table: TursoStoreTable): Promise<number> {
  assertTursoReady();
  const result = await tursoExecute({
    sql: `SELECT COUNT(*) AS total FROM ${tableName(table)}`,
    args: [],
  });
  return Number(result.rows[0]?.total ?? 0);
}

export async function factoryResetTransaction(params: { user: { rol: string } }) {
  assertTursoReady();
  if (params.user.rol !== 'administrador') throw new Error('Se requiere administrador.');
  return tursoInteractiveTransaction(async tx => {
    const tables = [
      'productos','movimientos','ventas','cxc','cxp','clientes','proveedores',
      'devoluciones','anulaciones','terminales','libro_diario','reportes_z','caja',
      'compras','operaciones','auditoria_sistema','legacy_documents','migration_runs',
      'catalogos','app_config','sessions'
    ];
    for (const name of tables) {
      await tx.execute({ sql: 'DELETE FROM ' + name, args: [], wantRows: false });
    }
    const seed = await tx.execute({
      sql: 'SELECT id,username,email,nombre,rol,password_hash,data_json FROM users WHERE is_seed_admin=1 LIMIT 1',
      args: [],
    });
    if (!seed.rows.length) {
      throw new Error('No se pudo conservar el administrador semilla.');
    }
    await tx.execute({ sql: "DELETE FROM users WHERE is_seed_admin=0", args: [], wantRows: false });
    await tx.execute({ sql: "UPDATE users SET acceso_bloqueado=0, rol='administrador', updated_at=CURRENT_TIMESTAMP WHERE is_seed_admin=1", args: [], wantRows: false });
    await tx.execute({
      sql: "INSERT INTO app_config(id,data_json,updated_at) VALUES('general',? ,CURRENT_TIMESTAMP)",
      args: [JSON.stringify({ isInitialized: false, ultimoZ: 0, proximoRecibo: 1, proximaDevolucion: 1, proximaAnulacion: 1, acumuladoHistorico: 0, fechaUltimoZ: '', fondoCajaHoyUSD: 0, fondoCajaHoyBS: 0, tasa: 36.50, pinDevolucion: '000000', empresa: { nombre: 'NOMBRE DE SU NEGOCIO', rif: 'J-00000000-0', direccion: 'DIRECCIÓN FISCAL', telefono: '0000-0000000' } })],
      wantRows: false,
    });
    return { ok: true, seedAdmin: { id: String(seed.rows[0].id), username: String(seed.rows[0].username) } };
  });
}

export async function getAppConfig(): Promise<any> {
  assertTursoReady();
  const result = await tursoExecute({ sql: 'SELECT data_json FROM app_config WHERE id=? LIMIT 1', args: ['general'] });
  if (!result.rows.length) return {};
  try { return JSON.parse(String(result.rows[0].data_json || '{}')); } catch { return {}; }
}

export async function patchAppConfig(patch: Record<string, any>): Promise<any> {
  assertTursoReady();
  const current = await getAppConfig();
  const next = { ...current, ...clean(patch) };
  await tursoExecute({ sql: 'INSERT INTO app_config(id,data_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, updated_at=CURRENT_TIMESTAMP', args: ['general', JSON.stringify(next)], wantRows: false });
  return next;
}

export async function getCatalog(name: string): Promise<any[]> {
  assertTursoReady();
  const catalogName = String(name);
  const defaults = catalogName === 'departamentos' ? DEFAULT_DEPARTAMENTOS
    : catalogName === 'categorias' ? DEFAULT_CATEGORIAS : null;
  const result = await tursoExecute({ sql: 'SELECT lista_json FROM catalogos WHERE nombre=? LIMIT 1', args: [catalogName] });
  let current: any[] = [];
  if (result.rows.length) {
    try { const parsed = JSON.parse(String(result.rows[0].lista_json || '[]')); current = Array.isArray(parsed) ? parsed : []; } catch {}
  }
  if (!defaults) return current;
  const seen = new Set(current.map(item => String(item).trim().toLocaleLowerCase('es')));
  const merged = [...current, ...defaults.filter(item => !seen.has(item.toLocaleLowerCase('es')) )];
  if (!result.rows.length || merged.length !== current.length) {
    await tursoExecute({
      sql: 'INSERT INTO catalogos(nombre,lista_json,data_json,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(nombre) DO UPDATE SET lista_json=excluded.lista_json, updated_at=CURRENT_TIMESTAMP',
      args: [catalogName, JSON.stringify(merged), '{}'], wantRows: false,
    });
  }
  return merged;
}

export async function patchCatalog(name: string, lista: any[]): Promise<any[]> {
  assertTursoReady();
  const cleanList = clean(lista);
  const value = Array.isArray(cleanList) ? cleanList : [];
  await tursoExecute({ sql: 'INSERT INTO catalogos(nombre,lista_json,data_json,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(nombre) DO UPDATE SET lista_json=excluded.lista_json, updated_at=CURRENT_TIMESTAMP', args: [String(name), JSON.stringify(value), '{}'], wantRows: false });
  return value;
}
export async function syncProductChanges(params: {
  changes: Array<{ before?: any | null; after?: any | null }>;
  deletedIds?: string[];
}): Promise<{ products: any[]; deletedIds: string[] }> {
  assertTursoReady();
  const changes = Array.isArray(params.changes) ? params.changes : [];
  const deletedIds = Array.isArray(params.deletedIds) ? params.deletedIds.map(String) : [];
  if (changes.length + deletedIds.length > 450) throw new Error('El lote de productos supera el límite seguro de 450 registros.');

  return tursoInteractiveTransaction(async tx => {
    const products: any[] = [];
    const deleted = new Set<string>();

    for (const change of changes) {
      const after = change?.after;
      const before = change?.before;
      const id = String(after?.id || before?.id || '');
      if (!id) continue;

      const current = rowFromDb((await tx.execute(txSelect('productos', id))).rows[0]);

      if (!before) {
        if (current) throw new Error('El producto ' + id + ' ya existe en Turso.');
        if (!after) continue;
        await tx.execute(rowStatement('productos', after));
        products.push(after);
        continue;
      }

      if (!current) throw new Error('El producto ' + id + ' ya no existe en Turso.');

      const beforeStock = Number(before.stock) || 0;
      const afterStock = Number(after?.stock) || 0;
      const deltaStock = after ? afterStock - beforeStock : 0;
      const next = after ? { ...current, ...after, stock: (Number(current.stock) || 0) + deltaStock, id } : current;
      await tx.execute(rowStatement('productos', next));
      products.push(next);
    }

    for (const id of deletedIds) {
      await tx.execute({ sql: 'DELETE FROM productos WHERE id=?', args: [id], wantRows: false });
      deleted.add(id);
    }

    return { products, deletedIds: [...deleted] };
  });
}

export async function syncRecords(params: {
  table: TursoStoreTable;
  records: any[];
  deletedIds?: string[];
}): Promise<{ records: any[]; deletedIds: string[] }> {
  assertTursoReady();
  const table = params.table;
  const records = Array.isArray(params.records) ? params.records : [];
  const deletedIds = Array.isArray(params.deletedIds) ? params.deletedIds.map(String) : [];
  if (records.length + deletedIds.length > 450) throw new Error('El lote supera el límite seguro de 450 registros.');

  return tursoInteractiveTransaction(async tx => {
    for (const id of deletedIds) {
      await tx.execute({ sql: `DELETE FROM ${tableName(table)} WHERE id=?`, args: [id], wantRows: false });
    }
    for (const record of records) await tx.execute(rowStatement(table, record));
    return { records, deletedIds };
  });}

export async function upsertRecords(table: TursoStoreTable, records: any[]): Promise<{ count: number }> {
  assertTursoReady();
  if (!records.length) return { count: 0 };
  if (records.length > 450) throw new Error('El lote supera el límite seguro de 450 registros.');
  await tursoInteractiveTransaction(async tx => {
    for (const record of records) await tx.execute(rowStatement(table, record));
  });
  return { count: records.length };
}

