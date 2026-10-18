import { randomBytes } from 'node:crypto';
import { tursoExecute, tursoTransaction } from '@/lib/turso/client';
import { createMigratedUser } from '@/lib/auth/turso-auth';

export type FirebaseBackup = {
  app?: string;
  version?: number;
  createdAt?: string;
  data?: Record<string, any>;
  meta?: any;
};

const COLLECTION_TABLES: Record<string, string> = {
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
  cashHistory: 'caja',
  compras: 'compras',
};

const CATALOG_KEYS = [
  'categorias', 'departamentos', 'marcas', 'presentaciones',
  'productCategories', 'productUnits', 'productColors', 'productSizes',
  'brands', 'groups', 'subgroups', 'lines', 'suppliers',
];

const AUXILIARY_TABLES: Record<string, string> = {
  operaciones: 'operaciones',
  auditoriaSistema: 'auditoria_sistema',
};

function asRows(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function rowId(row: any, index: number) {
  return String(row?.id ?? row?.uid ?? `legacy_${index}`);
}

function extractFecha(row: any) {
  const value = row?.fecha ?? row?.createdAt ?? row?.fechaCreacion ?? row?.created_at ?? null;
  return value == null ? null : String(value);
}

function safeJson(value: any) {
  return JSON.stringify(value ?? {});
}

function generatedPassword() {
  return 'PV-' + randomBytes(18).toString('base64url');
}

const USER_REFERENCE_KEYS = ['usuarioId','usuario_id','userId','user_id','firebaseUid','cajeroId','cajero_id','createdBy','created_by','updatedBy','updated_by','openedBy','opened_by','closedBy','closed_by','anuladoPor','anulado_por','revertidoPor','revertido_por','responsableId','responsable_id'];
const TERMINAL_REFERENCE_KEYS = ['terminalId','terminal_id','cajaId','caja_id'];
type ReferenceAudit = { byCollection: Record<string,{user:Record<string,number>;terminal:Record<string,number>}>; userReferences:Array<{collection:string;field:string;value:string;count:number}>; terminalReferences:Array<{collection:string;field:string;value:string;count:number}> };
function auditObject(value:any, collection:string, audit:ReferenceAudit, seen=new WeakSet<object>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return; seen.add(value);
  if (Array.isArray(value)) { for (const item of value) auditObject(item,collection,audit,seen); return; }
  const bucket = audit.byCollection[collection] ||= {user:{},terminal:{}};
  for (const [key,raw] of Object.entries(value)) {
    if (USER_REFERENCE_KEYS.includes(key) && raw != null && String(raw).trim()) { const v=String(raw).trim(); const k=key+'='+v; bucket.user[k]=(bucket.user[k]||0)+1; }
    if (TERMINAL_REFERENCE_KEYS.includes(key) && raw != null && String(raw).trim()) { const v=String(raw).trim(); const k=key+'='+v; bucket.terminal[k]=(bucket.terminal[k]||0)+1; }
    auditObject(raw,collection,audit,seen);
  }
}
export function auditarReferenciasFirebase(backup:FirebaseBackup):ReferenceAudit {
  validateFirebaseBackup(backup); const audit:ReferenceAudit={byCollection:{},userReferences:[],terminalReferences:[]}; const data=backup.data||{};
  for (const [key,table] of Object.entries(COLLECTION_TABLES)) for (const row of asRows(data[key])) auditObject(row,table,audit);
  for (const key of Object.keys(AUXILIARY_TABLES)) for (const row of asRows(data[key])) auditObject(row,key,audit);
  for (const [collection,bucket] of Object.entries(audit.byCollection)) {
    for (const [compound,count] of Object.entries(bucket.user)) { const i=compound.indexOf('='); audit.userReferences.push({collection,field:compound.slice(0,i),value:compound.slice(i+1),count}); }
    for (const [compound,count] of Object.entries(bucket.terminal)) { const i=compound.indexOf('='); audit.terminalReferences.push({collection,field:compound.slice(0,i),value:compound.slice(i+1),count}); }
  }
  return audit;
}

export function validateFirebaseBackup(backup: FirebaseBackup) {
  if (!backup || backup.app !== 'posven-pro' || !backup.data || typeof backup.data !== 'object') {
    throw new Error('El archivo no es un respaldo válido de POSVEN-Pro.');
  }
  return {
    version: Number(backup.version || 0),
    createdAt: backup.createdAt || null,
    users: asRows(backup.data.users).length,
    terminales: asRows(backup.data.terminales).length,
    ventas: asRows(backup.data.ventas).length,
    movimientos: asRows(backup.data.movimientos).length,
    caja: asRows(backup.data.cashHistory).length,
    reportesZ: asRows(backup.data.reportesZ).length,
  };
}

export async function importarRespaldoFirebase(
  backup: FirebaseBackup,
  options: {
    passwordByFirebaseUid?: Record<string, string>;
    dryRun?: boolean;
  } = {},
) {
  const summary = validateFirebaseBackup(backup);
  const data = backup.data!;
  const dryRun = options.dryRun !== false;

  if (dryRun) return { mode: 'dry-run', ...summary };

  const runId = 'migration_' + Date.now().toString(36) + '_' + randomBytes(6).toString('hex');
  const startedAt = new Date().toISOString();

  await tursoExecute({
    sql: `INSERT INTO migration_runs (id, source, backup_version, started_at, status, counts_json)
      VALUES (?, 'firebase', ?, ?, 'running', ?)`,
    args: [runId, Number(backup.version || 0), startedAt, safeJson(summary)],
    wantRows: false,
  });

  try {
    // Primero perfiles: conservar Firebase UID como identidad primaria cuando no haya conflicto.
    for (const row of asRows(data.users)) {
      const firebaseUid = String(row.uid || row.firebaseUid || row.id || '').trim();
      if (!firebaseUid) continue;

      const username = String(
        row.username ||
        row.usuario ||
        row.email?.split('@')[0] ||
        ('cajero_' + firebaseUid.slice(0, 8))
      ).trim().toLowerCase();

      const password = options.passwordByFirebaseUid?.[firebaseUid] || generatedPassword();
      const user = await createMigratedUser({
        firebaseUid,
        username,
        email: row.email || null,
        nombre: String(row.nombre || username).trim(),
        password,
        rol: row.rol === 'administrador' ? 'administrador' : 'cajero',
        fechaCreacion: row.fechaCreacion || null,
        dataJson: safeJson(row),
      });

      await tursoExecute({
        sql: `INSERT INTO user_identity_map (source, legacy_user_id, user_id, firebase_uid)
          VALUES ('firebase', ?, ?, ?)
          ON CONFLICT(source, legacy_user_id) DO UPDATE SET
            user_id=excluded.user_id, firebase_uid=excluded.firebase_uid`,
        args: [String(row.id || firebaseUid), user?.id || firebaseUid, firebaseUid],
        wantRows: false,
      });
    }

    for (const [key, table] of Object.entries(COLLECTION_TABLES)) {
      const rows = asRows(data[key]);
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const id = rowId(row, index);
        await tursoExecute({
          sql: `INSERT INTO ${table} (id, data_json, fecha, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
              data_json=excluded.data_json,
              fecha=excluded.fecha,
              updated_at=CURRENT_TIMESTAMP`,
          args: [id, safeJson(row), extractFecha(row)],
          wantRows: false,
        });
      }
    }

    // CxC debe conservar la misma factura que originó la deuda.
    // Respaldos antiguos pueden traer ventaId pero no los items dentro de la deuda.
    // Las ventas ya fueron importadas arriba, así que enlazamos cada deuda con su
    // venta original y guardamos un snapshot de items/montos para Consultar Créditos.
    for (const debt of asRows(data.cxc)) {
      const debtId = rowId(debt, 0);
      const ventaId = String(debt?.ventaId || '').trim();
      if (!ventaId) continue;
      const saleResult = await tursoExecute({ sql: 'SELECT id,data_json FROM ventas WHERE id=? LIMIT 1', args: [ventaId] });
      if (!saleResult.rows.length) continue;
      let sale:any = null;
      try { sale = JSON.parse(String(saleResult.rows[0].data_json || '{}')); } catch { sale = null; }
      if (!sale || !Array.isArray(sale.items)) continue;
      const enrichedDebt = {
        ...debt,
        ventaId,
        facturaId: String(debt?.facturaId || ventaId),
        items: sale.items.map((item:any) => ({ ...item })),
        subtotalUSD: Number(debt?.subtotalUSD ?? sale.subtotalUSD ?? sale.totalUSD ?? 0),
        totalUSD: Number(debt?.totalUSD ?? sale.totalUSD ?? debt?.montoUSD ?? 0),
        totalBS: Number(debt?.totalBS ?? sale.totalBS ?? 0),
        tasa: Number(debt?.tasa ?? sale.tasa ?? 0),
      };
      await tursoExecute({ sql: 'UPDATE cxc SET data_json=?, fecha=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', args: [safeJson(enrichedDebt), extractFecha(enrichedDebt), debtId], wantRows: false });
    }

    for (const key of CATALOG_KEYS) {
      const rows = asRows(data[key]);
      await tursoExecute({
        sql: `INSERT INTO catalogos (nombre, lista_json, data_json, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(nombre) DO UPDATE SET
            lista_json=excluded.lista_json,
            data_json=excluded.data_json,
            updated_at=CURRENT_TIMESTAMP`,
        args: [key, safeJson(rows), safeJson({ nombre: key, lista: rows })],
        wantRows: false,
      });
    }

    for (const [key, table] of Object.entries(AUXILIARY_TABLES)) {
      for (let index = 0; index < asRows(data[key]).length; index++) {
        const row = asRows(data[key])[index];
        const id = rowId(row, index);
        if (table === 'operaciones') {
          await tursoExecute({
            sql: `INSERT INTO operaciones (id, prefijo, operation_id, data_json)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                prefijo=excluded.prefijo, operation_id=excluded.operation_id, data_json=excluded.data_json`,
            args: [
              id,
              String(row.prefijo || row.prefix || 'legacy'),
              String(row.operationId || row.operation_id || id),
              safeJson(row),
            ],
            wantRows: false,
          });
        } else {
          await tursoExecute({
            sql: `INSERT INTO auditoria_sistema (id, tipo, terminal_id, usuario_id, fecha, data_json)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                tipo=excluded.tipo, terminal_id=excluded.terminal_id,
                usuario_id=excluded.usuario_id, fecha=excluded.fecha,
                data_json=excluded.data_json`,
            args: [
              id,
              row.tipo || null,
              row.terminalId || row.terminal_id || null,
              row.usuarioId || row.usuario_id || row.uid || null,
              extractFecha(row),
              safeJson(row),
            ],
            wantRows: false,
          });
        }
      }
    }

    for (const [path, value] of Object.entries(data)) {
      if (path === 'pos_system_data/state' || path === 'data/state') {
        await tursoExecute({
          sql: `INSERT INTO legacy_documents (path, data_json, present)
            VALUES (?, ?, 1)
            ON CONFLICT(path) DO UPDATE SET data_json=excluded.data_json, present=1, imported_at=CURRENT_TIMESTAMP`,
          args: [path, safeJson(value)],
          wantRows: false,
        });
      }
    }

    await tursoExecute({
      sql: `UPDATE migration_runs SET finished_at=?, status='completed', counts_json=? WHERE id=?`,
      args: [new Date().toISOString(), safeJson(summary), runId],
      wantRows: false,
    });

    return { mode: 'imported', runId, ...summary };
  } catch (error: any) {
    await tursoExecute({
      sql: `UPDATE migration_runs SET finished_at=?, status='failed', notes=? WHERE id=?`,
      args: [new Date().toISOString(), String(error?.message || error), runId],
      wantRows: false,
    }).catch(() => {});
    throw error;
  }
}


/**
 * Repara CxC ya migrado sin volver a importar el respaldo.
 * Solo sincroniza el snapshot de factura (items y totales) desde la venta
 * enlazada por ventaId. No modifica pagos, abonos ni saldo pendiente.
 */
export async function repararDeudasMigradas() {
  const debts = await tursoExecute({ sql: 'SELECT id,data_json FROM cxc' });
  const result = {
    revisadas: debts.rows.length,
    corregidas: 0,
    sinVenta: 0,
    sinItemsVenta: 0,
    sinCambios: 0,
    detalles: [] as Array<{id:string;ventaId:string;estado:string}>,
  };

  for (const row of debts.rows) {
    const id = String(row.id ?? '').trim();
    let debt:any = null;
    try { debt = JSON.parse(String(row.data_json || '{}')); } catch { debt = null; }
    if (!debt || typeof debt !== 'object') {
      result.detalles.push({ id, ventaId: '', estado: 'datos_deuda_invalidos' });
      continue;
    }
    const ventaId = String(debt.ventaId || debt.facturaId || '').trim();
    if (!ventaId) {
      result.sinVenta++;
      result.detalles.push({ id, ventaId: '', estado: 'sin_ventaId' });
      continue;
    }

    const saleResult = await tursoExecute({
      sql: 'SELECT data_json FROM ventas WHERE id=? LIMIT 1',
      args: [ventaId],
    });
    if (!saleResult.rows.length) {
      result.sinVenta++;
      result.detalles.push({ id, ventaId, estado: 'venta_no_encontrada' });
      continue;
    }

    let sale:any = null;
    try { sale = JSON.parse(String(saleResult.rows[0].data_json || '{}')); } catch { sale = null; }
    if (!sale || !Array.isArray(sale.items)) {
      result.sinItemsVenta++;
      result.detalles.push({ id, ventaId, estado: 'venta_sin_items' });
      continue;
    }

    const nextDebt = {
      ...debt,
      ventaId,
      facturaId: String(debt.facturaId || sale.facturaId || ventaId),
      items: sale.items.map((item:any) => ({ ...item })),
      subtotalUSD: Number(sale.subtotalUSD ?? sale.subtotal ?? debt.subtotalUSD ?? 0),
      totalUSD: Number(sale.totalUSD ?? debt.totalUSD ?? debt.montoUSD ?? 0),
      totalBS: Number(sale.totalBS ?? debt.totalBS ?? 0),
      tasa: Number(sale.tasa ?? debt.tasa ?? 0),
    };

    const before = safeJson(debt);
    const after = safeJson(nextDebt);
    if (before === after) {
      result.sinCambios++;
      result.detalles.push({ id, ventaId, estado: 'ya_consistente' });
      continue;
    }

    await tursoExecute({
      sql: 'UPDATE cxc SET data_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      args: [after, id],
      wantRows: false,
    });
    result.corregidas++;
    result.detalles.push({ id, ventaId, estado: 'corregida' });
  }

  return result;
}

export async function verificarMigracionFirebase(backup: FirebaseBackup) {
  const expected = validateFirebaseBackup(backup);
  const data = backup.data || {};
  const counts: Record<string, number> = {};
  for (const table of Object.values(COLLECTION_TABLES)) {
    const result = await tursoExecute({ sql: `SELECT COUNT(*) AS total FROM ${table}` });
    counts[table] = Number(result.rows[0]?.total || 0);
  }
  const users = await tursoExecute({ sql: 'SELECT COUNT(*) AS total FROM users WHERE firebase_uid IS NOT NULL' });
  const identities = await tursoExecute({ sql: "SELECT COUNT(*) AS total FROM user_identity_map WHERE source='firebase'" });
  const audit = auditarReferenciasFirebase(backup);
  const userRows = await tursoExecute({ sql: 'SELECT id, firebase_uid FROM users' });
  const userIds = new Set<string>();
  for (const row of userRows.rows) { if (row.id != null) userIds.add(String(row.id)); if (row.firebase_uid != null) userIds.add(String(row.firebase_uid)); }
  const terminalRows = await tursoExecute({ sql: 'SELECT id FROM terminales' });
  const terminalIds = new Set<string>(terminalRows.rows.map((row:any) => String(row.id)));
  const unresolvedUserReferences = audit.userReferences.filter(ref => !userIds.has(ref.value));
  const unresolvedTerminalReferences = audit.terminalReferences.filter(ref => !terminalIds.has(ref.value));

  const expectedCounts = {
    users: asRows(data.users).length,
    terminales: asRows(data.terminales).length,
    ventas: asRows(data.ventas).length,
    movimientos: asRows(data.movimientos).length,
    caja: asRows(data.cashHistory).length,
    reportesZ: asRows(data.reportesZ).length,
  };
  const checks = {
    usersCount: Number(users.rows[0]?.total || 0) >= expectedCounts.users,
    terminalesCount: counts.terminales >= expectedCounts.terminales,
    ventasCount: counts.ventas >= expectedCounts.ventas,
    movimientosCount: counts.movimientos >= expectedCounts.movimientos,
    cajaCount: counts.caja >= expectedCounts.caja,
    reportesZCount: counts.reportes_z >= expectedCounts.reportesZ,
    identityMap: Number(identities.rows[0]?.total || 0) >= expectedCounts.users,
    terminalUserReferences: unresolvedUserReferences.length === 0,
    terminalReferences: unresolvedTerminalReferences.length === 0,
  };
  return {
    expected: expectedCounts,
    actual: {
      users: Number(users.rows[0]?.total || 0),
      terminales: counts.terminales,
      ventas: counts.ventas,
      movimientos: counts.movimientos,
      caja: counts.caja,
      reportesZ: counts.reportes_z,
      firebaseIdentityMap: Number(identities.rows[0]?.total || 0),
    },
    referenceAudit: audit,
    unresolvedUserReferences,
    unresolvedTerminalReferences,
    checks,
    ok: Object.values(checks).every(Boolean),
  };
}
