/**
 * Repositorio POSVEN sobre Turso.
 *
 * Exclusivamente servidor. No activa Turso ni toca Firebase por sí solo.
 * Las operaciones críticas usan transacción interactiva para conservar la
 * semántica de concurrencia que tenía Firestore runTransaction().
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
  // productos no tiene columna fecha; se ordena por updated_at. Las demás
  // tablas operativas sí conservan fecha para ordenar cronológicamente.
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
      'catalogos','app_config','user_identity_map','sessions'
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
    await tx.execute({
      sql: "DELETE FROM users WHERE is_seed_admin=0",
      args: [],
      wantRows: false,
    });
    await tx.execute({
      sql: "UPDATE users SET acceso_bloqueado=0, rol='administrador', updated_at=CURRENT_TIMESTAMP WHERE is_seed_admin=1",
      args: [],
      wantRows: false,
    });
    await tx.execute({
      sql: "INSERT INTO app_config(id,data_json,updated_at) VALUES('general',? ,CURRENT_TIMESTAMP)",
      args: [JSON.stringify({
        isInitialized: false,
        ultimoZ: 0,
        proximoRecibo: 1,
        proximaDevolucion: 1,
        proximaAnulacion: 1,
        acumuladoHistorico: 0,
        fechaUltimoZ: '',
        fondoCajaHoyUSD: 0,
        fondoCajaHoyBS: 0,
        tasa: 36.50,
        pinDevolucion: '000000',
        empresa: {
          nombre: 'NOMBRE DE SU NEGOCIO',
          rif: 'J-00000000-0',
          direccion: 'DIRECCIÓN FISCAL',
          telefono: '0000-0000000'
        }
      })],
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
  const result = await tursoExecute({ sql: 'SELECT lista_json FROM catalogos WHERE nombre=? LIMIT 1', args: [String(name)] });
  if (!result.rows.length) return [];
  try { const value = JSON.parse(String(result.rows[0].lista_json || '[]')); return Array.isArray(value) ? value : []; } catch { return []; }
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

      // El stock se modifica por delta para no pisar una venta/ajuste concurrente.
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

/**
 * Venta atómica: venta + inventario + kardex + asiento + CxC + cliente +
 * correlativo + idempotencia en una sola transacción.
 */
export async function createSaleTransaction(params: {
  operationId: string;
  cart: any[];
  payments: any[];
  clientName: string;
  terminalId?: string;
  fallbackReceiptNumber?: number;
  now: string;
  tasa: number;
  saleType?: string;
  credit?: { customer: any; debtId: string };
  cajeroId?: string;
}) {
  assertTursoReady();
  const { operationId, cart, payments, clientName, terminalId, fallbackReceiptNumber, now,
    tasa, saleType = 'VENTA', credit, cajeroId } = params;

  if (!cart?.length) throw new Error('La venta no contiene productos.');
  if (!(Number(tasa) > 0)) throw new Error('La tasa de la venta no es válida.');

  return tursoInteractiveTransaction(async tx => {
    const opCheck = await tx.execute({
      sql: 'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',
      args: ['VENTA', operationId],
    });
    if (opCheck.rows.length) throw new Error('Esta operación ya fue procesada. No se registrará nuevamente.');

    const terminal = terminalId
      ? rowFromDb((await tx.execute(txSelect('terminales', terminalId))).rows[0])
      : null;
    if (terminalId && !terminal) throw new Error('La caja/terminal ya no existe en Turso.');

    let nextNumber = Math.max(1, Number(terminal?.proximoRecibo ?? fallbackReceiptNumber ?? 1));
    const salePrefix = await terminalUniquePrefix(tx, terminal, terminalId);
    // Recuperación segura para bases migradas: si el contador de una caja quedó
    // atrasado respecto de sus ventas ya existentes, avanzamos SOLO el contador
    // de esa caja hasta encontrar el siguiente correlativo libre. No se toca la
    // serie ni el contador de ninguna otra terminal.
    let reciboId = terminalSeries(salePrefix, 'V', nextNumber, 9);
    for (let guard = 0; guard < 100000; guard++) {
      const existingSale = await tx.execute(txSelect('ventas', reciboId));
      if (!existingSale.rows.length) break;
      nextNumber += 1;
      reciboId = terminalSeries(salePrefix, 'V', nextNumber, 9);
      if (guard === 99999) throw new Error('No se pudo obtener un correlativo libre para esta caja.');
    }

    const products = new Map<string, any>();
    const productIds = [...new Set(cart.map(i => String(i.productoId || '')).filter(Boolean))];
    for (const pid of productIds) {
      const product = rowFromDb((await tx.execute(txSelect('productos', pid))).rows[0]);
      if (!product) throw new Error('Un producto de la venta ya no existe en Turso.');
      products.set(pid, product);
    }

    const componentIds = new Set<string>();
    for (const item of cart) {
      const p = products.get(String(item.productoId));
      if (p?.isKit && p.kitType === 'stock_componentes' && Array.isArray(p.kitItems)) {
        p.kitItems.forEach((ki: any) => componentIds.add(String(ki.productoId)));
      }
    }
    for (const pid of componentIds) {
      if (!products.has(pid)) {
        const product = rowFromDb((await tx.execute(txSelect('productos', pid))).rows[0]);
        if (!product) throw new Error('Un componente del kit ya no existe en Turso.');
        products.set(pid, product);
      }
    }

    let customer: any = null;
    if (credit?.customer) {
      if (credit.customer.id) {
        customer = rowFromDb((await tx.execute(txSelect('clientes', credit.customer.id))).rows[0]);
      }
      if (!customer && credit.customer.cedula) {
        const found = await tx.execute({
          sql: "SELECT id,data_json FROM clientes WHERE json_extract(data_json,'$.cedula')=? LIMIT 1",
          args: [String(credit.customer.cedula)],
        });
        customer = rowFromDb(found.rows[0]);
      }
      // Un cliente recién creado puede existir todavía solo en el navegador.
      // Turso debe crearlo dentro de la MISMA transacción de venta + CxC.
      if (!customer && credit.customer) {
        const incoming = clean(credit.customer);
        customer = {
          id: String(incoming.id || crypto.randomUUID()),
          name: String(incoming.name || '').trim().toUpperCase(),
          cedula: String(incoming.cedula || '').trim(),
          phone: String(incoming.phone || ''),
          address: String(incoming.address || ''),
          debt: Number(incoming.debt) || 0,
        };
        if (!customer.name || !customer.cedula) {
          throw new Error('El cliente nuevo requiere nombre y cédula.');
        }
      }
      if (!customer) throw new Error('No se pudo resolver el cliente para la venta a crédito.')
    }

    const totals = cart.reduce((acc: any, item: any) => {
      const p = products.get(String(item.productoId));
      const sub = Number(item.subtotalUSD) || 0;
      if (p?.aplicaIVA) {
        const base = sub / 1.16;
        acc.base += base;
        acc.iva += sub - base;
      } else acc.exento += sub;
      acc.total += sub;
      return acc;
    }, { total: 0, base: 0, iva: 0, exento: 0 });

    // Validar pagos por moneda en céntimos. Para pagos en Bs se suma
    // PRIMERO el total Bs y se convierte UNA sola vez a USD; esto evita que
    // una venta cubierta exactamente en Bs falle porque cada uno de varios
    // métodos Bs fue redondeado individualmente al convertirlo a USD.
    const totalCentsUsd = Math.round((Number(totals.total) || 0) * 100);
    const tasaCents = Math.round(Number(tasa) * 100);
    const esMetodoUSD = (metodo: any) => {
      const m = String(metodo || '').toLowerCase().trim();
      return ['efectivo_usd', 'efectivo usd', 'usd', 'dolar', 'dolares', 'zelle'].some(x => m.includes(x));
    };
    const paidBsCents = payments.reduce((s, p) => {
      if (esMetodoUSD(p?.metodo)) return s;
      return s + Math.round((Number(p?.montoBS) || 0) * 100);
    }, 0);
    const paidUsdCents = payments.reduce((s, p) => {
      if (!esMetodoUSD(p?.metodo)) return s;
      return s + Math.round((Number(p?.montoUSD) || 0) * 100);
    }, 0);
    const paidBsAsUsdCents = tasaCents > 0
      ? Math.round((paidBsCents * 100) / tasaCents)
      : 0;
    const totalPaidCentsUsd = paidBsAsUsdCents + paidUsdCents;
    if (!credit && totalPaidCentsUsd < totalCentsUsd) {
      throw new Error('El pago recibido es menor al total de la venta.');
    }
    const totalPaid = totalPaidCentsUsd / 100;

    const deductions = new Map<string, { qty: number; references: string[] }>();
    for (const item of cart) {
      const p = products.get(String(item.productoId));
      if (!p) throw new Error('Producto no encontrado.');
      const qty = Number(item.cantidad) || 0;
      if (qty <= 0) throw new Error('La venta contiene una cantidad inválida.');
      if (p.isKit && p.kitType === 'stock_componentes' && Array.isArray(p.kitItems)) {
        for (const ki of p.kitItems) {
          const id = String(ki.productoId);
          const d = deductions.get(id) || { qty: 0, references: [] };
          d.qty += qty * (Number(ki.cantidad) || 0);
          d.references.push(String(p.nombre || item.nombre || item.productoId));
          deductions.set(id, d);
        }
      } else {
        const id = String(p.id);
        const d = deductions.get(id) || { qty: 0, references: [] };
        d.qty += qty;
        d.references.push(String(p.nombre || item.nombre || item.productoId));
        deductions.set(id, d);
      }
    }

    const productUpdates = new Map<string, any>();
    const movements: any[] = [];
    for (const [pid, deduction] of deductions) {
      const p = products.get(pid);
      const stock = Number(p?.stock) || 0;
      if (!p || stock < deduction.qty) throw new Error('Stock insuficiente para: ' + (p?.nombre || pid));
      const updated = { ...p, stock: stock - deduction.qty };
      productUpdates.set(pid, updated);
      movements.push({
        id: 'MOV-' + crypto.randomUUID(),
        productoId: pid,
        tipo: 'venta',
        cantidad: -deduction.qty,
        stockAntes: stock,
        stockDespues: updated.stock,
        fecha: now,
        referencia: saleType + ' ' + reciboId + (deduction.references.length > 1 ? ' - SALIDA AGRUPADA' : ''),
        terminalId: terminalId || 'GLOBAL',
      });
    }

    const igtf = payments
      .filter(p => p.metodo === 'efectivo_usd' || p.metodo === 'zelle')
      .reduce((s, p) => s + (Number(p.montoUSD) || 0) * 0.03, 0);

    const sale = {
      id: reciboId, fecha: now, cliente: clientName, items: cart.map(x => ({ ...x })),
      subtotalUSD: totals.total, descuentoUSD: 0, totalUSD: totals.total, totalBS: totals.total * tasa,
      metodoPago: credit ? 'credito' : (payments.length > 1 ? 'mixto' : (payments[0]?.metodo || 'efectivo_usd')),
      estado: 'completada', type: saleType, received: totalPaid,
      change: Math.max(0, totalPaid - totals.total), payments: payments.map(x => ({ ...x })),
      terminalId, terminalName: terminal?.nombre || 'SISTEMA GLOBAL', cajeroId,
      baseImponibleUSD: Math.round(totals.base * 100) / 100,
      ivaUSD: Math.round(totals.iva * 100) / 100, exentoUSD: Math.round(totals.exento * 100) / 100,
      igtfUSD: Math.round(igtf * 100) / 100, tasa,
    };

    const journals = credit ? [] : payments.map(p => ({
      id: 'ACC-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase(),
      fecha: now, tipo: 'ingreso', categoria: 'VENTA',
      concepto: `VENTA #${reciboId} - CLIENTE: ${String(clientName).toUpperCase()}`,
      montoUSD: Number(p.montoUSD) || 0,
      montoBS: Number(p.montoBS) || (Number(p.montoUSD) || 0) * tasa,
      metodo: p.metodo, referencia: reciboId + '-' + (terminalId || 'GLOBAL'),
      terminalId: terminalId || 'GLOBAL',
    }));

    const debt = credit ? {
      id: 'CRD-' + reciboId, fecha: now.slice(0, 10), fechaVencimiento: '2099-12-31',
      cliente: `${customer.name} [${customer.cedula}]`, montoUSD: totals.total,
      subtotalUSD: totals.total, totalUSD: totals.total, totalBS: totals.total * tasa, tasa,
      abonadoUSD: 0, saldoUSD: totals.total, estado: 'pendiente', historialPagos: [],
      ventaId: reciboId, facturaId: reciboId,
      // Snapshot exacto de la factura original para que CxC conserve items,
      // cantidades y precios aun cuando cambie el catálogo posteriormente.
      items: cart.map((x: any) => ({ ...x })),
    } : null;
    const writes: TursoStatement[] = [{
      sql: 'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',
      args: [
        'VENTA-' + operationId, 'VENTA', operationId,
        JSON.stringify({ tipo: 'VENTA', operationId, referencia: reciboId, terminalId: terminalId || 'GLOBAL' }),
      ],
      wantRows: false,
    }, rowStatement('ventas', sale)];

    for (const product of productUpdates.values()) writes.push(rowStatement('productos', product));
    for (const movement of movements) writes.push(rowStatement('movimientos', movement));
    for (const journal of journals) writes.push(rowStatement('libroDiario', journal));
    if (debt) writes.push(rowStatement('cxc', debt));
    if (customer) writes.push(rowStatement('clientes', { ...customer, debt: (Number(customer.debt) || 0) + totals.total }));
    if (terminal) writes.push(rowStatement('terminales', { ...terminal, proximoRecibo: nextNumber + 1 }));

    for (const statement of writes) await tx.execute(statement);

    return {
      sale, debt, journals, products: [...productUpdates.values()],
      nextNumber: nextNumber + 1,
      terminal: terminal ? { ...terminal, id: terminalId, proximoRecibo: nextNumber + 1 } : null,
    };
  });
}

/**
 * Inventario atómico: el stock se lee y calcula dentro de BEGIN IMMEDIATE.
 */
/**
 * Reconciliación segura de stock: Kardex es la fuente de verdad.
 * Solo corrige productos que ya tienen al menos un movimiento en Kardex.
 * No modifica cantidades ni movimientos; únicamente sincroniza productos.stock
 * con el stockDespues del último movimiento cronológico.
 */
export async function syncProductsStockFromKardex() {
  assertTursoReady();
  return tursoInteractiveTransaction(async tx => {
    await tx.execute({
      sql: `
        UPDATE productos
        SET data_json = json_set(
          data_json,
          '$.stock',
          (
            SELECT COALESCE(json_extract(m.data_json,'$.stockDespues'),0)
            FROM movimientos m
            WHERE json_extract(m.data_json,'$.productoId') = productos.id
            ORDER BY COALESCE(m.fecha,'' ) DESC, m.id DESC
            LIMIT 1
          )
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE EXISTS (
          SELECT 1
          FROM movimientos m2
          WHERE json_extract(m2.data_json,'$.productoId') = productos.id
        )
      `,
      args: [],
      wantRows: false,
    });

    const result = await tx.execute({
      sql: `
        SELECT p.id,p.data_json
        FROM productos p
        WHERE EXISTS (
          SELECT 1
          FROM movimientos m
          WHERE json_extract(m.data_json,'$.productoId') = p.id
        )
      `,
      args: [],
    });

    const products = result.rows.map(rowFromDb).filter(Boolean);
    return { products, source: 'kardex' };
  });
}

export async function applyInventoryMovementsTransaction(params: {
  operationId: string;
  operationType: string;
  movements: any[];
  productPatches?: Record<string, any>;
}) {
  assertTursoReady();
  if (!params.movements?.length) throw new Error('No hay movimientos de inventario para registrar.');

  return tursoInteractiveTransaction(async tx => {
    const check = await tx.execute({
      sql: 'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',
      args: ['INVENTARIO', params.operationId],
    });
    if (check.rows.length) throw new Error('Esta operación ya fue procesada. No se registrará nuevamente.');

    const productIds = [...new Set(params.movements.map(m => String(m.productoId || '')).filter(Boolean))];
    if (params.movements.length + productIds.length + 2 > 450) {
      throw new Error('La operación contiene demasiados movimientos para una sola transacción.');
    }

    const products = new Map<string, any>();
    for (const pid of productIds) {
      const product = rowFromDb((await tx.execute(txSelect('productos', pid))).rows[0]);
      if (!product) throw new Error('El producto ' + pid + ' ya no existe en Turso.');
      products.set(pid, product);
    }

    const statements: TursoStatement[] = [{
      sql: 'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',
      args: ['INVENTARIO-' + params.operationId, 'INVENTARIO', params.operationId, JSON.stringify({
        tipo: params.operationType, operationId: params.operationId,
      })],
      wantRows: false,
    }];

    const persistedMovements: any[] = [];
    const persistedProducts: any[] = [];

    for (const pid of productIds) {
      let running = Number(products.get(pid)?.stock) || 0;
      for (const movement of params.movements.filter(m => String(m.productoId) === pid)) {
        const before = running;
        running += Number(movement.cantidad) || 0;
        const persisted = {
          ...movement,
          id: String(movement.id || ('MOV-' + crypto.randomUUID())),
          productoId: pid,
          stockAntes: before,
          stockDespues: running,
        };
        persistedMovements.push(persisted);
        statements.push(rowStatement('movimientos', persisted));
      }
      const persistedProduct = {
        ...products.get(pid), ...(params.productPatches?.[pid] || {}), stock: running,
      };
      persistedProducts.push(persistedProduct);
      statements.push(rowStatement('productos', persistedProduct));
    }

    for (const statement of statements) await tx.execute(statement);
    return { movements: persistedMovements, productIds, products: persistedProducts };
  });
}


function assertTerminalAccess(user: { rol: string; id: string; firebaseUid?: string | null }, terminal: any) {
  if (user.rol === 'administrador') return;
  const assigned = String(terminal?.usuarioId || '');
  const allowed = new Set([String(user.id), user.firebaseUid ? String(user.firebaseUid) : '']);
  if (!assigned || !allowed.has(assigned)) throw new Error('Esta terminal no está asignada al usuario autenticado.');
}

export async function patchTerminalTransaction(params: {
  user: { rol: string; id: string; firebaseUid?: string | null };
  terminalId: string;
  patch: Record<string, any>;
}) {
  assertTursoReady();
  return tursoInteractiveTransaction(async tx => {
    const current = rowFromDb((await tx.execute(txSelect('terminales', params.terminalId))).rows[0]);
    if (!current) throw new Error('La terminal ya no existe en Turso.');
    assertTerminalAccess(params.user, current);
    const updated = { ...current, ...clean(params.patch), id: params.terminalId };
    await tx.execute(rowStatement('terminales', updated));
    return { terminal: updated };
  });
}

export async function upsertTerminalTransaction(params: {
  user: { rol: string };
  terminal: any;
}) {
  assertTursoReady();
  if (params.user.rol !== 'administrador') throw new Error('Se requiere administrador.');
  if (!params.terminal?.id) throw new Error('La terminal no tiene id.');
  await tursoInteractiveTransaction(async tx => {
    await tx.execute(rowStatement('terminales', params.terminal));
  });
  return { terminal: params.terminal };
}

export async function deleteTerminalTransaction(params: {
  user: { rol: string };
  terminalId: string;
}) {
  assertTursoReady();
  if (params.user.rol !== 'administrador') throw new Error('Se requiere administrador.');
  return tursoInteractiveTransaction(async tx => {
    await tx.execute({ sql: 'DELETE FROM terminales WHERE id=?', args: [params.terminalId], wantRows: false });
    return { terminalId: params.terminalId };
  });
}

export async function createZClosureTransaction(params: {
  user: { rol: string; id: string; firebaseUid?: string | null };
  terminalId: string;
  report: any;
  terminalPatch: Record<string, any>;
}) {
  assertTursoReady();
  return tursoInteractiveTransaction(async tx => {
    const current = rowFromDb((await tx.execute(txSelect('terminales', params.terminalId))).rows[0]);
    if (!current) throw new Error('La terminal ya no existe en Turso.');
    assertTerminalAccess(params.user, current);

    const expectedNumber = Number(current.ultimoZ || 0) + 1;
    const requestedNumber = Number(params.report?.numeroZ || expectedNumber);
    if (requestedNumber !== expectedNumber) {
      throw new Error('El número Z cambió en otra caja. Actualice y vuelva a generar el corte.');
    }

    const prefix = await terminalUniquePrefix(tx, current, params.terminalId);
    // El servidor es la autoridad final del correlativo Z. Ignoramos cualquier
    // ID provisional enviado por el navegador y construimos uno exclusivo de
    // esta terminal para evitar que dos cajas puedan sobrescribirse.
    let report = { ...clean(params.report), id: terminalSeries(prefix, 'Z', expectedNumber, 6), terminalId: params.terminalId, numeroZ: expectedNumber };
    const canonical = await tx.execute(txSelect('reportesZ', report.id));
    if (canonical.rows.length) throw new Error('El corte Z de esta terminal ya fue registrado.');

    const updatedTerminal = { ...current, ...clean(params.terminalPatch), ultimoZ: expectedNumber, id: params.terminalId };
    await tx.execute(rowStatement('reportesZ', report));
    await tx.execute(rowStatement('terminales', updatedTerminal));
    return { report, terminal: updatedTerminal };
  });
}


export async function applyDebtPaymentTransaction(params: {
  operationId?: string; collection: 'cxc' | 'cxp'; debtId: string; amountUSD: number;
  amountBS?: number; payment: any; journal?: any | any[]; sale?: any; customerCedula?: string; terminalId?: string;
}) {
  assertTursoReady();
  const { operationId, collection, debtId, amountUSD, amountBS, payment, journal, sale, customerCedula, terminalId } = params;
  // CxP se procesa desde Administración y no depende de ninguna Caja/Terminal.
  // Solo CxC conserva la relación con la caja del cajero.
  const terminalForOperation = collection === 'cxc' ? terminalId : undefined;
  if (!(Number(amountUSD) > 0)) return null;
  return tursoInteractiveTransaction(async tx => {
    const opId = String(operationId || payment?.id || (collection+'|'+debtId+'|'+amountUSD+'|'+payment?.metodo+'|'+payment?.fecha));
    const check = await tx.execute({sql:'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',args:['PAGO-DEUDA',opId]});
    if (check.rows.length) throw new Error('Esta operación ya fue procesada. No se registrará nuevamente.');
    const debt = rowFromDb((await tx.execute(txSelect(collection,debtId))).rows[0]);
    if (!debt) throw new Error('La deuda ya no existe.');

    // Las deudas iniciales creadas desde Administración no tienen venta/factura
    // asociada. El cobro individual del POS debe tratarlas como una CxC válida
    // exactamente igual que una deuda originada por una venta a crédito.
    const historialPrevio = Array.isArray(debt.historialPagos) ? debt.historialPagos : [];
    const abonadoHistorial = historialPrevio.reduce((sum:number, p:any) => sum + Math.max(0, Number(p?.montoUSD) || 0), 0);
    const montoInicial = Math.max(0, Number(debt.montoUSD) || 0);
    const abonadoRegistrado = Math.max(0, Number(debt.abonadoUSD) || 0);
    // Para deudas iniciales sin venta/items, el saldo almacenado puede venir
    // desactualizado (por ejemplo 0) aunque montoUSD siga pendiente. La fuente
    // segura es el mayor abonado registrado/histórico y el monto original.
    const abonadoBase = Math.min(montoInicial, Math.max(abonadoRegistrado, abonadoHistorial));
    const saldoCalculado = Math.max(0, montoInicial - abonadoBase);
    const saldoPersistido = Number(debt.saldoUSD);
    const saldo = Number.isFinite(saldoPersistido) && saldoPersistido >= saldoCalculado
      ? saldoPersistido
      : saldoCalculado;
    const saldoCents = Math.round(saldo * 100);
    const amountCents = Math.round(Number(amountUSD) * 100);
    if (saldoCents <= 0) throw new Error('La deuda ya está pagada.');
    if (amountCents > saldoCents) throw new Error('El monto a pagar no puede ser mayor al saldo pendiente.');

    const terminal = terminalForOperation ? rowFromDb((await tx.execute(txSelect('terminales',terminalForOperation))).rows[0]) : null;
    if (terminalForOperation && !terminal) throw new Error('La caja/terminal ya no existe en Turso.');
    const field = collection==='cxc'?'proximoCobroDeuda':'proximoPagoProveedor';
    const label = collection==='cxc'?'CXC':'CXP';
    const counter=Number(terminal?.[field])||1;
    const receiptId=terminal?terminalSeries(await terminalUniquePrefix(tx,terminal,terminalForOperation),label,counter,6):terminalSeries('GLOBAL',label,Date.now(),6);
    const applied=Math.min(amountCents, saldoCents) / 100;
    const appliedBS=Number(amountBS)>0?Math.min(Number(amountBS),Number(payment?.montoBS)||Number(amountBS)):(Number(payment?.montoBS)||(applied*(Number(payment?.tasaAplicada)||0)));

    const paymentWithTerminal = collection === 'cxc'
      ? {...payment, terminalId: terminalForOperation || payment?.terminalId, terminalName: terminal?.nombre || payment?.terminalName}
      : {...payment, terminalId: undefined, terminalName: undefined};
    const pago=clean({...paymentWithTerminal,id:receiptId,reciboId:receiptId,terminalForOperation:terminalForOperation||payment?.terminalForOperation,montoUSD:applied,montoBS:appliedBS});

    const updated={...debt,abonadoUSD:abonadoRegistrado+applied,saldoUSD:Math.max(0,saldo-applied),estado:Math.round((saldo-applied)*100)<=0?'pagada':'parcial',historialPagos:[...historialPrevio,pago]};
    const statements:TursoStatement[]=[rowStatement(collection,updated)];

    if(collection==='cxc'){
      // Primero usamos la cédula enviada por el POS. Si la deuda inicial no
      // la trae por alguna razón, recuperamos la identidad desde "cliente".
      const clienteRaw = String(debt.cliente || '');
      const cedulaDeuda = String(customerCedula || (clienteRaw.match(/\[([^\]]+)\]\s*$/)?.[1] || '')).trim();
      const nombreDeuda = clienteRaw.replace(/\s*\[[^\]]+\]\s*$/, '').trim();

      let found;
      if (cedulaDeuda) {
        found = await tx.execute({
          sql:"SELECT id,data_json FROM clientes WHERE json_extract(data_json,'$.cedula')=? LIMIT 1",
          args:[cedulaDeuda]
        });
      }
      if ((!found || !found.rows.length) && nombreDeuda) {
        found = await tx.execute({
          sql:"SELECT id,data_json FROM clientes WHERE LOWER(TRIM(json_extract(data_json,'$.name'))) = LOWER(TRIM(?)) LIMIT 1",
          args:[nombreDeuda]
        });
      }
      const customer=rowFromDb(found?.rows?.[0]);
      if(customer) {
        statements.push(rowStatement('clientes',{...customer,debt:Math.max(0,(Number(customer.debt)||0)-applied)}));
      }
    }
    const journals=Array.isArray(journal)?journal:(journal?[journal]:[]);
    for(const entry of journals) if(entry?.id) statements.push(rowStatement('libroDiario',{...entry,referencia:receiptId,terminalForOperation:terminalForOperation||entry.terminalForOperation,terminalName:terminal?.nombre||entry.terminalName}));
    const persistedSale=sale?.id?{...sale,id:receiptId,terminalForOperation:terminalForOperation||sale.terminalForOperation,terminalName:terminal?.nombre||sale.terminalName}:null;
    if(persistedSale) statements.push(rowStatement('ventas',persistedSale));
    if(terminal) statements.push(rowStatement('terminales',{...terminal,[field]:counter+1}));
    statements.push({sql:'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',args:['PAGO-DEUDA-'+opId,'PAGO-DEUDA',opId,JSON.stringify({tipo:'PAGO-DEUDA',operationId:opId,referencia:debtId})],wantRows:false});
    for(const s of statements) await tx.execute(s);
    return {...updated,appliedUSD:applied,appliedBS,receiptId,payment:pago,journal:journals,sale:persistedSale,terminal:terminal?{...terminal,id:terminalForOperation,[field]:counter+1}:null};
  });
}

async function applyGlobalPayment(params:any, collection:'cxc'|'cxp'){
  assertTursoReady();
  const {operationId,provider,customerName,customerCedula,amountUSD,amountBS,payment,paymentParts,journal,terminalId}=params;
  if(!(Number(amountUSD)>0)) return {appliedUSD:0,appliedBS:0,debts:[]};
  // Los pagos globales a proveedores se originan en Administración → CxP
  // y son administrativos: no dependen de ninguna Caja/Terminal.
  const terminalForOperation = collection === 'cxc' ? terminalId : undefined;
  return tursoInteractiveTransaction(async tx=>{
    const opId=String(operationId||payment?.id||((collection==='cxp'?'CXP-GLOBAL':'CXC-GLOBAL')+'|'+(provider||customerName)+'|'+amountUSD+'|'+payment?.fecha+'|'+payment?.metodo));
    const prefix=collection==='cxp'?'PAGO-CXP-GLOBAL':'PAGO-CXC-GLOBAL';
    const check=await tx.execute({sql:'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',args:[prefix,opId]});
    if(check.rows.length) throw new Error('Esta operación ya fue procesada. No se registrará nuevamente.');
    const terminal=terminalForOperation?rowFromDb((await tx.execute(txSelect('terminales',terminalForOperation))).rows[0]):null;
    if(terminalForOperation&&!terminal) throw new Error('La caja/terminal ya no existe en Turso.');
    const field=collection==='cxp'?'proximoPagoProveedor':'proximoCobroDeuda';
    const label=collection==='cxp'?'CXP':'CXC';
    const counter=Number(terminal?.[field])||1;
    const receiptId=terminal?terminalSeries(terminalPrefix(terminal,terminalId),label,counter,6):terminalSeries('GLOBAL',label,Date.now(),6);
    const matchField=collection==='cxp'?'proveedor':'cliente';
    const matchValue=collection==='cxp'?String(provider||''):String(customerName||'');
    let docs:any[] = [];
    if (collection === 'cxc') {
      // Las deudas históricas pueden estar guardadas con o sin la cédula
      // embebida en el campo cliente. El cobro debe localizar ambas formas.
      const candidates = customerCedula
        ? await tx.execute({
            sql:"SELECT id,data_json FROM cxc WHERE (json_extract(data_json,'$.cliente')=? OR json_extract(data_json,'$.cliente')=?) ORDER BY COALESCE(fecha,'') ASC,id ASC",
            args:[String(customerName || ''), String(customerName || '')+' ['+String(customerCedula)+']']
          })
        : await tx.execute({
            sql:"SELECT id,data_json FROM cxc WHERE json_extract(data_json,'$.cliente')=? ORDER BY COALESCE(fecha,'') ASC,id ASC",
            args:[String(customerName || '')]
          });
      docs = candidates.rows.map(rowFromDb);
    } else {
      const found=await tx.execute({
        sql:"SELECT id,data_json FROM "+tableName(collection)+" WHERE LOWER(TRIM(COALESCE(json_extract(data_json,'$."+matchField+"'),''))) = LOWER(TRIM(?)) ORDER BY COALESCE(fecha,'') ASC,id ASC",
        args:[matchValue]
      });
      docs = found.rows.map(rowFromDb);
    }
    docs = docs.filter((d:any)=>(Number(d?.saldoUSD)||0)>0.001&&d?.estado!=='pagada');
    let remCents=Math.max(0,Math.round(Number(amountUSD)*100));
    let remBS=Number(amountBS)>0?Number(amountBS):Number(amountUSD)*(Number(payment?.tasaAplicada)||0);
    let appliedUSD=0, appliedBS=0; const debts:any[]=[]; const statements:TursoStatement[]=[];
    for(const d of docs){
      if(remCents<=0) break;
      const debtCents=Math.max(0,Math.round((Number(d.saldoUSD)||0)*100));
      const pagoCents=Math.min(debtCents,remCents); if(pagoCents<=0) continue;
      const pago=pagoCents/100;
      const tasa=Number(payment?.tasaAplicada)||0; const pagoBS=Math.min(remBS,pago*tasa);
      remCents-=pagoCents; remBS=Math.max(0,remBS-pagoBS);
      const h=[...(Array.isArray(d.historialPagos)?d.historialPagos:[])];
      h.push(clean({...payment,id:receiptId,reciboId:receiptId,terminalId:collection==='cxc'?(terminalForOperation||payment?.terminalId):undefined,montoUSD:pago,montoBS:pagoBS}));
      const updated={...d,abonadoUSD:(Number(d.abonadoUSD)||0)+pago,saldoUSD:Math.max(0,(Number(d.saldoUSD)||0)-pago),estado:(Number(d.saldoUSD)-pago)<=0.001?'pagada':'parcial',historialPagos:h};
      statements.push(rowStatement(collection,updated)); debts.push({...updated,appliedUSD:pago,appliedBS:pagoBS}); appliedUSD+=pago; appliedBS+=pagoBS;
    }
    if(appliedUSD<=0.000001) throw new Error('No hay saldo pendiente para registrar este pago.');
    if(collection==='cxc'&&customerCedula){
      const foundCustomer=await tx.execute({sql:"SELECT id,data_json FROM clientes WHERE json_extract(data_json,'$.cedula')=? LIMIT 1",args:[String(customerCedula)]});
      const customer=rowFromDb(foundCustomer.rows[0]); if(customer) statements.push(rowStatement('clientes',{...customer,debt:Math.max(0,(Number(customer.debt)||0)-appliedUSD)}));
    }
    if(journal?.id) statements.push(rowStatement('libroDiario',{...journal,montoUSD:appliedUSD,montoBS:appliedBS,referencia:receiptId,terminalId:collection==='cxc'?(terminalForOperation||journal.terminalId):undefined,terminalName:collection==='cxc'?(terminal?.nombre||journal.terminalName):undefined}));

    // Un cobro de CxC también es una operación visible en el historial del POS,
    // pero NO es una venta de mercancía. Se guarda como registro de tipo
    // COBRO DEUDA para trazabilidad; los reportes X/Z lo excluyen del total de
    // ventas y lo muestran en el renglón específico de cobros.
    let sale: any = null;
    if (collection === 'cxc') {
      sale = {
        id: receiptId,
        fecha: String(payment?.fecha || new Date().toISOString()),
        cliente: String(customerName || 'CLIENTE'),
        items: [{
          productoId: 'ABONO',
          nombre: 'COBRO DE DEUDA',
          cantidad: 1,
          precioUnitUSD: appliedUSD,
          subtotalUSD: appliedUSD,
        }],
        subtotalUSD: appliedUSD,
        descuentoUSD: 0,
        totalUSD: appliedUSD,
        totalBS: appliedBS,
        metodoPago: payment?.metodo || 'mixto',
        estado: 'completada',
        type: 'COBRO DEUDA',
        received: appliedUSD,
        change: 0,
        terminalId: terminalId || 'GLOBAL',
        terminalName: terminal?.nombre || 'SISTEMA GLOBAL',
        payments: Array.isArray(paymentParts) && paymentParts.length ? (() => {
          const requestedUSD = paymentParts.reduce((s:number,p:any) => s + (Number(p.montoUSD) || 0), 0);
          const ratio = requestedUSD > 0 ? Math.min(1, appliedUSD / requestedUSD) : 1;
          return paymentParts.map((p:any) => ({
            ...p,
            id: receiptId + '-' + String(p?.metodo || 'OTROS'),
            terminalId: terminalId || p?.terminalId,
            reciboId: receiptId,
            montoUSD: (Number(p.montoUSD) || 0) * ratio,
            montoBS: (Number(p.montoBS) || 0) * ratio,
            tasaAplicada: Number(p?.tasaAplicada) || Number(payment?.tasaAplicada) || 0,
          })).filter((p:any) => p.montoUSD > 0.000001 || p.montoBS > 0.000001);
        })() : [{...payment, id: receiptId, reciboId: receiptId, montoUSD: appliedUSD, montoBS: appliedBS, terminalId: terminalId || payment?.terminalId}],
        baseImponibleUSD: 0,
        ivaUSD: 0,
        exentoUSD: 0,
        igtfUSD: 0,
        tasa: Number(payment?.tasaAplicada) || 0,
      };
      statements.push(rowStatement('ventas', sale));
    }

    if(terminal) statements.push(rowStatement('terminales',{...terminal,[field]:counter+1}));
    statements.push({sql:'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',args:[prefix+'-'+opId,prefix,opId,JSON.stringify({tipo:prefix,operationId:opId,referencia:receiptId,terminalId:collection==='cxc'?(terminalForOperation||'GLOBAL'):undefined})],wantRows:false});
    for(const s of statements) await tx.execute(s);
    return {appliedUSD,appliedBS,debts,receiptId,sale};
  });
}
export async function applyGlobalProviderPaymentTransaction(params:any){ return applyGlobalPayment(params,'cxp'); }
export async function applyGlobalCustomerPaymentTransaction(params:any){ return applyGlobalPayment(params,'cxc'); }

export async function createCustomerDebtTransaction(params:any){
  assertTursoReady();
  return tursoInteractiveTransaction(async tx=>{
    const opId=String(params.operationId||params.debt?.id);
    const check=await tx.execute({sql:'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',args:['DEUDA-CXC',opId]});
    if(check.rows.length) throw new Error('Esta operación ya fue procesada. No se registrará nuevamente.');
    const debt=params.debt; if(!debt?.id) throw new Error('La deuda no tiene id.');
    if((await tx.execute(txSelect('cxc',debt.id))).rows.length) throw new Error('La deuda ya existe en Turso.');
    const statements:TursoStatement[]=[rowStatement('cxc',debt)];
    let customer=null;
    if(params.customerId) customer=rowFromDb((await tx.execute(txSelect('clientes',params.customerId))).rows[0]);
    if(!customer&&params.customerCedula) customer=rowFromDb((await tx.execute({sql:"SELECT id,data_json FROM clientes WHERE json_extract(data_json,'$.cedula')=? LIMIT 1",args:[String(params.customerCedula)]})).rows[0]);
    if(customer) {
      customer = {
        ...customer,
        debt: (Number(customer.debt)||0) + (Number(debt.montoUSD)||0),
        address: params.customer?.address || customer.address || 'Sin dirección',
        phone: params.customer?.phone || customer.phone || 'Sin teléfono',
      };
      statements.push(rowStatement('clientes',customer));
    } else if(params.customer?.id) {
      customer = {
        ...params.customer,
        debt: Number(params.customer.debt) || Number(debt.montoUSD) || 0,
      };
      statements.push(rowStatement('clientes',customer));
    }
    if(params.journal?.id) statements.push(rowStatement('libroDiario',params.journal));
    statements.push({sql:'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',args:['DEUDA-CXC-'+opId,'DEUDA-CXC',opId,JSON.stringify({tipo:'DEUDA-CXC',operationId:opId,referencia:debt.id})],wantRows:false});
    for(const s of statements) await tx.execute(s); return {debt,customer};
  });
}
export async function createSupplierDebtTransaction(params:any){
  assertTursoReady();
  return tursoInteractiveTransaction(async tx=>{
    const opId=String(params.operationId||params.debt?.id);
    const check=await tx.execute({sql:'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',args:['DEUDA-CXP',opId]});
    if(check.rows.length) throw new Error('Esta operación ya fue procesada. No se registrará nuevamente.');
    const debt=params.debt; if(!debt?.id) throw new Error('La deuda no tiene id.');
    if((await tx.execute(txSelect('cxp',debt.id))).rows.length) throw new Error('La deuda ya existe en Turso.');
    const statements:TursoStatement[]=[rowStatement('cxp',debt)]; if(params.journal?.id) statements.push(rowStatement('libroDiario',params.journal));
    statements.push({sql:'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',args:['DEUDA-CXP-'+opId,'DEUDA-CXP',opId,JSON.stringify({tipo:'DEUDA-CXP',operationId:opId,referencia:debt.id})],wantRows:false});
    for(const s of statements) await tx.execute(s); return debt;
  });
}

export async function processReturnOrCancellationTransaction(params:any){
  assertTursoReady();
  const {
    operationId,
    operationType,
    saleId,
    operationDoc,
    movements = [],
    journal,
    terminalId,
    refundItems = [],
    fullCancellation = false,
  } = params;

  return tursoInteractiveTransaction(async tx => {
    const opCheck = await tx.execute({
      sql:'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',
      args:[operationType,operationId],
    });
    if(opCheck.rows.length) throw new Error('Esta operación ya fue procesada. No se registrará nuevamente.');

    const sale = rowFromDb((await tx.execute(txSelect('ventas',String(saleId)))).rows[0]);
    if(!sale) throw new Error('La venta ya no existe en Turso.');
    if(operationType==='ANULACION' && String(sale.estado||'')==='anulada')
      throw new Error('La factura ya fue anulada.');

    const terminal = terminalId
      ? rowFromDb((await tx.execute(txSelect('terminales',terminalId))).rows[0])
      : null;
    if(terminalId && !terminal) throw new Error('La terminal de la operación ya no existe.');

    // ============================================================
    // REGLA MAESTRA DE DEVOLUCIONES/ANULACIONES
    // Una unidad vendida solo puede reingresar al inventario UNA vez.
    // El servidor Turso recalcula aquí lo que todavía queda por revertir;
    // nunca confía en que el navegador le envíe las cantidades originales.
    // ============================================================
    const originalItems = Array.isArray(sale.items) ? sale.items : [];
    if(!originalItems.length) throw new Error('La venta no contiene detalle para revertir.');

    const previousReturnsRows = await tx.execute({
      sql:"SELECT id,data_json FROM devoluciones WHERE json_extract(data_json,'$.ventaId')=? ORDER BY COALESCE(fecha,''),id",
      args:[String(saleId)],
    });
    const previousReturns = previousReturnsRows.rows.map(rowFromDb).filter(Boolean);

    const returnedByProduct = new Map<string,number>();
    for(const dev of previousReturns){
      for(const item of (Array.isArray(dev?.items)?dev.items:[])){
        const pid=String(item?.productoId||'');
        if(!pid) continue;
        returnedByProduct.set(pid,(returnedByProduct.get(pid)||0)+Math.max(0,Number(item?.cantidad)||0));
      }
    }

    const remainingItems:any[]=[];
    for(const item of originalItems){
      const pid=String(item?.productoId||'');
      const originalQty=Math.max(0,Number(item?.cantidad)||0);
      const alreadyReturned=returnedByProduct.get(pid)||0;
      const remaining=Math.max(0,originalQty-alreadyReturned);
      if(remaining<=0) continue;
      const unit=originalQty>0 ? Number(item?.subtotalUSD||0)/originalQty : Number(item?.precioUnitUSD||0);
      remainingItems.push({
        ...item,
        cantidad:remaining,
        precioUnitUSD:Number(item?.precioUnitUSD ?? unit)||0,
        subtotalUSD:Math.round((remaining*(Number(item?.precioUnitUSD ?? unit)||0)+Number.EPSILON)*100)/100,
      });
    }

    if(operationType==='DEVOLUCION'){
      const requested = Array.isArray(refundItems) && refundItems.length ? refundItems : (Array.isArray(operationDoc?.items)?operationDoc.items:[]);
      if(!requested.length) throw new Error('La devolución no contiene productos.');

      const remainingByProduct=new Map(remainingItems.map((i:any)=>[String(i.productoId),i]));
      const effectiveItems:any[]=[];
      const seen=new Set<string>();

      for(const requestedItem of requested){
        const pid=String(requestedItem?.productoId||'');
        if(!pid || seen.has(pid)) continue;
        seen.add(pid);
        const available=remainingByProduct.get(pid);
        if(!available) throw new Error('Este producto ya fue devuelto en su totalidad.');
        const qty=Math.max(0,Number(requestedItem?.cantidad)||0);
        if(qty<=0 || qty>Number(available.cantidad||0)+0.000001)
          throw new Error('La cantidad solicitada supera la cantidad todavía pendiente de devolución.');

        const unit=Number(available.precioUnitUSD)||0;
        effectiveItems.push({
          ...available,
          ...requestedItem,
          cantidad:qty,
          precioUnitUSD:unit,
          subtotalUSD:Math.round((qty*unit+Number.EPSILON)*100)/100,
        });
      }

      if(!effectiveItems.length) throw new Error('No hay unidades pendientes de devolución.');
      remainingItems.splice(0,remainingItems.length,...effectiveItems);
    }

    const effectiveItems = remainingItems.map((item:any)=>({
      ...item,
      cantidad:Math.max(0,Number(item.cantidad)||0),
      subtotalUSD:Math.round((Math.max(0,Number(item.cantidad)||0)*(Number(item.precioUnitUSD)||0)+Number.EPSILON)*100)/100,
    })).filter((item:any)=>item.cantidad>0);

    if(!effectiveItems.length)
      throw new Error('La factura ya no tiene mercancía pendiente de reversión.');

    const effectiveTotal=Math.round((effectiveItems.reduce((sum:number,item:any)=>sum+(Number(item.subtotalUSD)||0),0)+Number.EPSILON)*100)/100;

    // En una anulación total posterior a una devolución parcial, SOLO se
    // registra lo que todavía quedaba pendiente. Así, 2 Polar ya devueltas
    // no vuelven a entrar al Kardex y únicamente retorna el producto restante.
    const effectiveMovements:any[]=[];
    const requestedMovementsByProduct=new Map<string,any[]>();
    for(const m of (Array.isArray(movements)?movements:[])){
      const pid=String(m?.productoId||'');
      if(!pid) continue;
      const arr=requestedMovementsByProduct.get(pid)||[];
      arr.push(m);
      requestedMovementsByProduct.set(pid,arr);
    }

    for(const item of effectiveItems){
      const pid=String(item.productoId);
      const requestedMovement=requestedMovementsByProduct.get(pid)?.[0];
      const shouldReintegrate = operationType==='ANULACION'
        ? true
        : String(item.estadoProducto||requestedMovement?.estadoProducto||'REINTEGRADO_STOCK')==='REINTEGRADO_STOCK';

      if(!shouldReintegrate) continue;
      effectiveMovements.push({
        ...(requestedMovement||{}),
        id:String(requestedMovement?.id||('MOV-'+crypto.randomUUID())),
        productoId:pid,
        tipo:operationType==='ANULACION'?'anulacion':'devolucion',
        cantidad:Number(item.cantidad)||0,
        fecha:String(operationDoc?.fecha||new Date().toISOString()),
        referencia:operationType==='ANULACION'
          ? 'ANULACIÓN TOTAL FACTURA #'+String(saleId)
          : 'DEVOLUCIÓN '+String(operationDoc?.id||operationId)+' - REF VENTA '+String(saleId),
        terminalId:terminalId||operationDoc?.terminalId||'GLOBAL',
      });
    }

    const products=new Map<string,any>();
    for(const m of effectiveMovements){
      const pid=String(m.productoId||'');
      if(!pid || products.has(pid)) continue;
      const p=rowFromDb((await tx.execute(txSelect('productos',pid))).rows[0]);
      if(!p) throw new Error('Un producto de la operación ya no existe en Turso.');
      products.set(pid,p);
    }

    // ============================================================
    // CxC: una devolución/anulación reduce el saldo pendiente de la
    // factura a crédito. No crea un cobro ni un reembolso ficticio.
    // ============================================================
    let updatedDebt:any=null;
    const debtRows=await tx.execute({
      sql:"SELECT id,data_json FROM cxc WHERE json_extract(data_json,'$.ventaId')=? OR json_extract(data_json,'$.facturaId')=? ORDER BY id LIMIT 10",
      args:[String(saleId),String(saleId)],
    });
    const debtRowsMapped=debtRows.rows.map(rowFromDb).filter(Boolean);
    if(debtRowsMapped.length){
      const debt=debtRowsMapped[0];
      const currentSaldo=Math.max(0,Number(debt.saldoUSD)||0);
      const reversal=Math.min(currentSaldo,effectiveTotal);
      const nuevoSaldo=Math.max(0,Math.round((currentSaldo-reversal+Number.EPSILON)*100)/100);
      updatedDebt={
        ...debt,
        saldoUSD:nuevoSaldo,
        estado:nuevoSaldo<=0.001?'pagada':'parcial',
        ...(operationType==='ANULACION' && nuevoSaldo<=0.001 ? {cancelada:true, canceladaFecha:String(operationDoc?.fecha||new Date().toISOString())} : {}),
      };
      // No alteramos abonadoUSD: los pagos reales siguen siendo pagos reales.
      // La devolución solo reduce la obligación todavía pendiente.
    }

    const field=operationType==='DEVOLUCION'?'proximaDevolucion':'proximaAnulacion';
    const label=operationType==='DEVOLUCION'?'DEV':'ANU';
    const counter=Number(terminal?.[field])||1;
    const canonicalId=terminal
      ? terminalSeries(await terminalUniquePrefix(tx,terminal,terminalId),label,counter,6)
      : terminalSeries('GLOBAL',label,Date.now(),6);
    const table=operationType==='DEVOLUCION'?'devoluciones':'anulaciones';
    if((await tx.execute(txSelect(table,canonicalId))).rows.length)
      throw new Error('Esta operación ya fue registrada.');

    const canonicalOperationDoc=clean({
      ...operationDoc,
      id:canonicalId,
      ventaId:String(saleId),
      terminalId:terminalId||operationDoc?.terminalId||'GLOBAL',
      terminalName:terminal?.nombre||operationDoc?.terminalName||'SISTEMA GLOBAL',
      items:effectiveItems,
      totalUSD:effectiveTotal,
      ...(operationType==='ANULACION' ? { totalRevertidoUSD:effectiveTotal } : {}),
    });

    // Si la venta era a crédito y no tenía pagos, nunca puede existir un
    // egreso de dinero por una devolución/anulación.
    const originalPaid=Array.isArray(sale.payments)
      ? sale.payments.reduce((sum:number,p:any)=>sum+(Number(p?.montoUSD)||0),0)
      : 0;
    if(updatedDebt && originalPaid<=0.001){
      delete canonicalOperationDoc.refundPayments;
      canonicalOperationDoc.metodoReembolso='nota_credito';
    }

    const statements:TursoStatement[]=[];

    for(const m of effectiveMovements){
      const pid=String(m.productoId);
      const p=products.get(pid);
      const before=Number(p.stock)||0;
      const after=before+(Number(m.cantidad)||0);
      const persisted={...m,productoId:pid,stockAntes:before,stockDespues:after,id:String(m.id||('MOV-'+crypto.randomUUID()))};
      products.set(pid,{...p,stock:after});
      statements.push(rowStatement('movimientos',persisted));
    }

    for(const p of products.values()) statements.push(rowStatement('productos',p));

    // Solo el monto realmente devuelto en efectivo/tarjeta/etc. genera
    // asiento de egreso. Nota de crédito sin pago no mueve caja.
    const refundTotal=Array.isArray(canonicalOperationDoc.refundPayments)
      ? canonicalOperationDoc.refundPayments.reduce((sum:number,p:any)=>sum+(Number(p?.montoUSD)||0),0)
      : 0;

    const canonicalJournal=journal && refundTotal>0.001
      ? {...journal,montoUSD:refundTotal,referencia:canonicalId,terminalId:terminalId||journal.terminalId,terminalName:terminal?.nombre||journal.terminalName}
      : null;

    statements.push(rowStatement(table,canonicalOperationDoc));
    statements.push(rowStatement('ventas',{
      ...sale,
      estado:operationType==='ANULACION'?'anulada':'parcialmente_devuelta'
    }));
    if(updatedDebt) statements.push(rowStatement('cxc',updatedDebt));
    if(canonicalJournal) statements.push(rowStatement('libroDiario',canonicalJournal));
    if(terminal) statements.push(rowStatement('terminales',{...terminal,[field]:counter+1}));

    statements.push({
      sql:'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',
      args:[
        operationType+'-'+operationId,
        operationType,
        operationId,
        JSON.stringify({tipo:operationType,operationId,referencia:canonicalId,terminalId:terminalId||'GLOBAL'})
      ],
      wantRows:false
    });

    if(statements.length>450) throw new Error('La operación contiene demasiados movimientos para una sola transacción.');
    for(const statement of statements) await tx.execute(statement);

    return {
      operationId,
      operationType,
      receiptId:canonicalId,
      operationDoc:canonicalOperationDoc,
      products:[...products.values()],
      movements:effectiveMovements,
      debt:updatedDebt,
      journal:canonicalJournal,
      terminal:terminal?{...terminal,id:terminalId,[field]:counter+1}:null,
      remainingAfter: operationType==='ANULACION' ? 0 : effectiveItems.reduce((s:number,i:any)=>s+(Number(i.cantidad)||0),0),
    };
  });
}


// ============================================================
// REPARACIÓN ÚNICA DE DEVOLUCIONES / ANULACIONES / CxC / KARDEX
// Recalcula una factura concreta desde su venta original y su historial
// real de devoluciones. No borra la auditoría: corrige el detalle de cada
// operación y elimina únicamente el efecto de inventario duplicado.
// ============================================================
export async function repairReturnInventoryAndCxcTransaction(params:{saleId:string;operationId?:string}){
  assertTursoReady();
  const saleId=String(params.saleId||'').trim();
  if(!saleId) throw new Error('Debe indicar la factura a reparar.');

  return tursoInteractiveTransaction(async tx=>{
    const sale=rowFromDb((await tx.execute(txSelect('ventas',saleId))).rows[0]);
    if(!sale) throw new Error('La factura indicada no existe en Turso.');

    const returnRows=(await tx.execute({
      sql:"SELECT id,data_json FROM devoluciones WHERE json_extract(data_json,'$.ventaId')=? ORDER BY COALESCE(fecha,''),id",
      args:[saleId],
    })).rows.map(rowFromDb).filter(Boolean);

    const annulRows=(await tx.execute({
      sql:"SELECT id,data_json FROM anulaciones WHERE json_extract(data_json,'$.ventaId')=? ORDER BY COALESCE(fecha,''),id",
      args:[saleId],
    })).rows.map(rowFromDb).filter(Boolean);

    const operations=[
      ...returnRows.map((doc:any)=>({kind:'DEVOLUCION',doc})),
      ...annulRows.map((doc:any)=>({kind:'ANULACION',doc})),
    ].sort((a:any,b:any)=>{
      const f=String(a.doc?.fecha||'').localeCompare(String(b.doc?.fecha||''));
      return f!==0?f:String(a.doc?.id||'').localeCompare(String(b.doc?.id||''));
    });

    const remaining=new Map<string,number>();
    for(const item of (Array.isArray(sale.items)?sale.items:[]))
      remaining.set(String(item?.productoId||''),Math.max(0,Number(item?.cantidad)||0));

    const correctedOps:any[]=[];
    const affectedProducts=new Set<string>();

    for(const operation of operations){
      const doc=operation.doc;
      const effective:any[]=[];

      if(operation.kind==='ANULACION'){
        for(const item of (Array.isArray(sale.items)?sale.items:[])){
          const pid=String(item?.productoId||'');
          const qty=Number(remaining.get(pid)||0);
          if(qty<=0) continue;
          const originalQty=Math.max(1,Number(item?.cantidad)||1);
          const unit=Number(item?.precioUnitUSD)||((Number(item?.subtotalUSD)||0)/originalQty);
          effective.push({
            ...item,
            cantidad:qty,
            precioUnitUSD:unit,
            subtotalUSD:Math.round((qty*unit+Number.EPSILON)*100)/100,
          });
          remaining.set(pid,0);
        }
      }else{
        for(const item of (Array.isArray(doc?.items)?doc.items:[])){
          const pid=String(item?.productoId||'');
          const available=Number(remaining.get(pid)||0);
          if(!pid||available<=0) continue;
          const qty=Math.min(available,Math.max(0,Number(item?.cantidad)||0));
          if(qty<=0) continue;
          const unit=Number(item?.precioUnitUSD)||0;
          effective.push({
            ...item,
            cantidad:qty,
            precioUnitUSD:unit,
            subtotalUSD:Math.round((qty*unit+Number.EPSILON)*100)/100,
          });
          remaining.set(pid,Math.max(0,available-qty));
        }
      }

      const totalUSD=Math.round((effective.reduce((sum:number,item:any)=>sum+(Number(item?.subtotalUSD)||0),0)+Number.EPSILON)*100)/100;
      const corrected={
        ...doc,
        items:effective,
        totalUSD,
        ...(operation.kind==='ANULACION'?{totalRevertidoUSD:totalUSD}:{}),
        ...(effective.length===0?{sinEfecto:true}:{}),
      };
      correctedOps.push({kind:operation.kind,doc:corrected,original:doc});

      // Corregimos SOLO los movimientos de esta operación. Las versiones
      // antiguas usaban el ID temporal (DEV-OP/ANU-OP) dentro de la referencia,
      // mientras la operación persistida usa el ID canónico; por eso la
      // identificación se hace por factura + tipo + fecha, con fallback al ID.
      const salePattern='%'+saleId+'%';
      const movementRows=(await tx.execute({
        sql:"SELECT id,data_json FROM movimientos WHERE json_extract(data_json,'$.tipo')=? AND json_extract(data_json,'$.referencia') LIKE ? ORDER BY COALESCE(fecha,''),id",
        args:[operation.kind==='ANULACION'?'anulacion':'devolucion',salePattern],
      })).rows.map(rowFromDb).filter(Boolean);

      const operationRows=movementRows.filter((m:any)=>
        String(m?.fecha||'')===String(doc?.fecha||'') ||
        String(m?.referencia||'').includes(String(doc?.id||'')) ||
        String(m?.referencia||'').includes(operation.kind==='ANULACION'?'ANULACIÓN TOTAL FACTURA':'DEVOLUCIÓN')
      );
      const candidateRows=operationRows.length?operationRows:movementRows.filter((m:any)=>!String(m?.reparadoPorOperacion||'').trim());
      const usedMovementIds=new Set<string>();
      const byProduct=new Map<string,any>();
      for(const item of effective){
        const pid=String(item?.productoId||'');
        if(!pid) continue;
        const current=byProduct.get(pid);
        if(current) current.cantidad+=Number(item?.cantidad)||0;
        else byProduct.set(pid,{...item,cantidad:Number(item?.cantidad)||0});
        affectedProducts.add(pid);
      }

      for(const movement of candidateRows){
        const pid=String(movement?.productoId||'');
        const item=byProduct.get(pid);
        if(!item || usedMovementIds.has(String(movement.id))){
          // Solo eliminamos una fila si sabemos que pertenece a esta operación.
          if(String(movement?.fecha||'')===String(doc?.fecha||'') || String(movement?.referencia||'').includes(String(doc?.id||''))){
            await tx.execute({sql:'DELETE FROM movimientos WHERE id=?',args:[String(movement.id)],wantRows:false});
          }
          continue;
        }

        const reintegrado=operation.kind==='ANULACION'
          ? true
          : String(item?.estadoProducto||movement?.estadoProducto||'REINTEGRADO_STOCK')==='REINTEGRADO_STOCK';

        if(!reintegrado){
          await tx.execute(rowStatement('movimientos',{
            ...movement,
            cantidad:Number(item.cantidad)||0,
            stockDespues:Number(movement.stockAntes)||0,
            efectoStock:0,
            reparadoPorOperacion:String(doc.id||''),
          }));
        }else{
          await tx.execute(rowStatement('movimientos',{
            ...movement,
            cantidad:Number(item.cantidad)||0,
            stockDespues:Number(movement.stockAntes||0)+(Number(item.cantidad)||0),
            reparadoPorOperacion:String(doc.id||''),
          }));
        }
        usedMovementIds.add(String(movement.id));
      }

      // Si la operación tenía una devolución/anulación válida pero no quedó
      // movimiento físico persistido, lo reconstruimos exactamente una vez.
      for(const [pid,item] of byProduct){
        const reintegrado=operation.kind==='ANULACION'
          ? true
          : String(item?.estadoProducto||'REINTEGRADO_STOCK')==='REINTEGRADO_STOCK';
        if(!reintegrado) continue;
        const hasMovement=[...usedMovementIds].some(id=>candidateRows.some((m:any)=>String(m.id)===id&&String(m.productoId)===pid));
        if(hasMovement) continue;
        const p=rowFromDb((await tx.execute(txSelect('productos',pid))).rows[0]);
        const movement={
          id:'REPAIR-MOV-'+crypto.randomUUID(),
          productoId:pid,
          tipo:operation.kind==='ANULACION'?'anulacion':'devolucion',
          cantidad:Number(item.cantidad)||0,
          stockAntes:Number(p?.stock)||0,
          stockDespues:(Number(p?.stock)||0)+(Number(item.cantidad)||0),
          fecha:String(doc.fecha||new Date().toISOString()),
          referencia:operation.kind==='ANULACION'
            ? 'ANULACIÓN TOTAL FACTURA #'+saleId
            : 'DEVOLUCIÓN '+String(doc.id)+' - REF VENTA '+saleId,
          terminalId:String(doc.terminalId||'GLOBAL'),
          reparado:true,
        };
        await tx.execute(rowStatement('movimientos',movement));
        usedMovementIds.add(String(movement.id));
      }

      if(JSON.stringify(corrected)!==JSON.stringify(doc))
        await tx.execute(rowStatement(operation.kind==='ANULACION'?'anulaciones':'devoluciones',corrected));
    }

    // CxC se recalcula desde la deuda original, pagos reales y el total
    // efectivamente revertido. No se inventan pagos ni reembolsos.
    const debtRow=(await tx.execute({
      sql:"SELECT id,data_json FROM cxc WHERE json_extract(data_json,'$.ventaId')=? OR json_extract(data_json,'$.facturaId')=? ORDER BY id LIMIT 1",
      args:[saleId,saleId],
    })).rows[0];
    let debt:any=null;
    let customer:any=null;
    if(debtRow){
      const originalDebt=rowFromDb(debtRow);
      const totalRevertido=correctedOps.reduce((sum:number,o:any)=>sum+(Number(o.doc?.totalUSD)||0),0);
      const originalAmount=Number(originalDebt.montoUSD)||Number(sale.totalUSD)||0;
      const paid=Number(originalDebt.abonadoUSD)||0;
      const saldo=Math.max(0,Math.round((originalAmount-totalRevertido-paid+Number.EPSILON)*100)/100);
      debt={
        ...originalDebt,
        saldoUSD:saldo,
        estado:saldo<=0.001?'pagada':'parcial',
        ...(saldo<=0.001&&correctedOps.some((o:any)=>o.kind==='ANULACION')?{cancelada:true,canceladaFecha:String(correctedOps.find((o:any)=>o.kind==='ANULACION')?.doc?.fecha||new Date().toISOString())}:{}),
      };
      await tx.execute(rowStatement('cxc',debt));

      const clienteTexto=String(originalDebt.cliente||'');
      const cedulaMatch=clienteTexto.match(/\[([^\]]+)\]/);
      const cedula=cedulaMatch?.[1]||'';
      if(cedula){
        const cr=(await tx.execute({
          sql:"SELECT id,data_json FROM clientes WHERE json_extract(data_json,'$.cedula')=? LIMIT 1",
          args:[cedula],
        })).rows[0];
        customer=cr?rowFromDb(cr):null;
      }
      if(customer){
        const customerDebts=(await tx.execute({
          sql:"SELECT data_json FROM cxc WHERE json_extract(data_json,'$.cliente')=?",
          args:[clienteTexto],
        })).rows.map(rowFromDb).filter(Boolean);
        const customerDebt=customerDebts.reduce((sum:number,d:any)=>sum+Math.max(0,Number(d?.saldoUSD)||0),0);
        customer={...customer,debt:Math.round((customerDebt+Number.EPSILON)*100)/100};
        await tx.execute(rowStatement('clientes',customer));
      }
    }

    // Recalcular stock de cada producto afectado usando el DELTA físico de
    // cada movimiento, no la cantidad declarada. Así las mermas (delta 0) no
    // alteran stock y el doble reingreso desaparece realmente.
    const products:any[]=[];
    const rebuiltAllMovements:any[]=[];
    for(const pid of affectedProducts){
      const rows=(await tx.execute({
        sql:"SELECT id,data_json FROM movimientos WHERE json_extract(data_json,'$.productoId')=? ORDER BY COALESCE(fecha,''),id",
        args:[pid],
      })).rows.map(rowFromDb).filter(Boolean);
      if(!rows.length) continue;
      let running=Number(rows[0]?.stockAntes)||0;
      const rebuilt:any[]=[];
      for(const movement of rows){
        const oldBefore=Number(movement?.stockAntes)||0;
        const oldAfter=Number(movement?.stockDespues)||oldBefore;
        const delta=oldAfter-oldBefore;
        const before=running;
        running=before+delta;
        const fixed={...movement,stockAntes:before,stockDespues:running};
        rebuilt.push(fixed);
        rebuiltAllMovements.push(fixed);
        await tx.execute(rowStatement('movimientos',fixed));
      }
      const p=rowFromDb((await tx.execute(txSelect('productos',pid))).rows[0]);
      if(p){
        const fixedProduct={...p,stock:running};
        await tx.execute(rowStatement('productos',fixedProduct));
        products.push(fixedProduct);
      }
    }

    // La venta queda anulada solo si ya existía una anulación; de lo contrario
    // la reparación no inventa una anulación nueva.
    const hasAnulacion=correctedOps.some((o:any)=>o.kind==='ANULACION');
    const fixedSale=hasAnulacion?{...sale,estado:'anulada'}:sale;
    if(hasAnulacion) await tx.execute(rowStatement('ventas',fixedSale));

    if(params.operationId){
      const opId=String(params.operationId);
      await tx.execute({
        sql:'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',
        args:['REPARAR-DEVOLUCION-'+opId,'REPARAR-DEVOLUCION',opId,JSON.stringify({tipo:'REPARAR-DEVOLUCION',operationId:opId,saleId})],
        wantRows:false,
      });
    }

    const correctedReturns=correctedOps.filter((o:any)=>o.kind==='DEVOLUCION').map((o:any)=>o.doc);
    const correctedAnulaciones=correctedOps.filter((o:any)=>o.kind==='ANULACION').map((o:any)=>o.doc);

    return {
      sale:fixedSale,
      debt,
      customer,
      products,
      devoluciones:correctedReturns,
      anulaciones:correctedAnulaciones,
      correctedOperations:correctedOps.length,
      affectedProducts:[...affectedProducts],
      movimientos:rebuiltAllMovements,
    };
  });
}

export async function createCashMovementTransaction(params: {
  operationId: string;
  movement: any;
  terminalId?: string;
}) {
  assertTursoReady();
  const { operationId, movement, terminalId } = params;
  if (!movement?.id) throw new Error('El movimiento de caja no tiene id.');
  return tursoInteractiveTransaction(async tx => {
    const opId = String(operationId || movement.id);
    const check = await tx.execute({
      sql: 'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',
      args: ['MOVIMIENTO-CAJA', opId],
    });
    if (check.rows.length) throw new Error('Esta operación ya fue procesada. No se registrará nuevamente.');
    const terminal = terminalId
      ? rowFromDb((await tx.execute(txSelect('terminales', terminalId))).rows[0])
      : null;
    if (terminalId && !terminal) throw new Error('La caja/terminal ya no existe en Turso.');
    const canonicalMovement = {
      ...movement,
      terminalId: terminalId || movement.terminalId || 'GLOBAL',
      terminalName: terminal?.nombre || movement.terminalName || 'SISTEMA GLOBAL',
    };
    await tx.execute(rowStatement('libroDiario', canonicalMovement));
    await tx.execute({
      sql: 'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',
      args: [
        'MOVIMIENTO-CAJA-' + opId,
        'MOVIMIENTO-CAJA',
        opId,
        JSON.stringify({ tipo: 'MOVIMIENTO-CAJA', operationId: opId, referencia: canonicalMovement.id, terminalId: canonicalMovement.terminalId }),
      ],
      wantRows: false,
    });
    return { movement: canonicalMovement };
  });
}

export async function reverseDebtPaymentTransaction(params:any){
  assertTursoReady();
  const {operationId,collection,debtId,paymentId,journalId}=params;
  return tursoInteractiveTransaction(async tx=>{
    const opId=String(operationId||collection+'|'+debtId+'|'+paymentId+'|REVERSE');
    const check=await tx.execute({sql:'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',args:['REVERSAR-PAGO',opId]});
    if(check.rows.length) throw new Error('Esta operación ya fue procesada. No se registrará nuevamente.');
    const debt=rowFromDb((await tx.execute(txSelect(collection,debtId))).rows[0]); if(!debt) throw new Error('La deuda ya no existe.');
    const historial=Array.isArray(debt.historialPagos)?debt.historialPagos:[]; const idx=historial.findIndex((p:any)=>String(p?.id||'')===String(paymentId));
    if(idx<0) throw new Error('El abono ya fue eliminado o no existe en la deuda.');
    const pago=historial[idx], restantes=historial.filter((_:any,i:number)=>i!==idx);
    const abonado=Math.max(0,Math.round((restantes.reduce((s:number,p:any)=>s+(Number(p?.montoUSD)||0),0)+Number.EPSILON)*100)/100);
    const saldo=Math.max(0,Math.round(((Number(debt.montoUSD)||0)-abonado+Number.EPSILON)*100)/100);
    const updated={...debt,abonadoUSD:abonado,saldoUSD:saldo,estado:saldo<=.001?'pagada':abonado>0?'parcial':'pendiente',historialPagos:restantes};
    const statements:TursoStatement[]=[rowStatement(collection,updated)];
    if(journalId){
      const jr=await tx.execute(txSelect('libroDiario',journalId)); const journal=rowFromDb(jr.rows[0]);
      if(journal){
        const monto=Math.max(0,Math.round(((Number(journal.montoUSD)||0)-(Number(pago?.montoUSD)||0)+Number.EPSILON)*100)/100);
        const montoBS=Math.max(0,Math.round(((Number(journal.montoBS)||0)-(Number(pago?.montoBS)||0)+Number.EPSILON)*100)/100);
        if(monto<=.001) await tx.execute({sql:'DELETE FROM libro_diario WHERE id=?',args:[journalId],wantRows:false});
        else statements.push(rowStatement('libroDiario',{...journal,montoUSD:monto,montoBS:montoBS,concepto:String(journal.concepto||'').replace(/ \(abono revertido\)$/i,'')+' (abono revertido)'}));
      }
    }
    statements.push({sql:'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',args:['REVERSAR-PAGO-'+opId,'REVERSAR-PAGO',opId,JSON.stringify({tipo:'REVERSAR-PAGO',operationId:opId,referencia:paymentId})],wantRows:false});
    for(const s of statements) await tx.execute(s);
    return {...updated,reversedPayment:pago};
  });
}
export async function deleteCustomerAndDebtsTransaction(params:any){
  assertTursoReady();
  return tursoInteractiveTransaction(async tx=>{
    const {operationId,customerId,customerName,customerCedula}=params; const opId=String(operationId||customerId);
    const check=await tx.execute({sql:'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',args:['ELIMINAR-CLIENTE',opId]});
    if(check.rows.length) throw new Error('Esta operación ya fue procesada. No se registrará nuevamente.');
    const customer=customerId?rowFromDb((await tx.execute(txSelect('clientes',customerId))).rows[0]):null; if(!customer) throw new Error('El cliente ya no existe.');
    const exact=customerCedula?String(customerName||customer.cliente||customer.nombre||'')+' ['+customerCedula+']':String(customerName||customer.cliente||customer.nombre||'');
    const found=await tx.execute({sql:"SELECT id,data_json FROM cxc WHERE json_extract(data_json,'$.cliente') IN (?,?)",args:[exact,String(customerName||customer.cliente||customer.nombre||'')]});
    const debts=found.rows.map(rowFromDb);
    const active=debts.find((d:any)=>d.estado!=='pagada'&&(Number(d.saldoUSD)||0)>.001); if(active) throw new Error('El cliente tiene una deuda pendiente.');
    for(const d of debts) await tx.execute({sql:'DELETE FROM cxc WHERE id=?',args:[d.id],wantRows:false});
    await tx.execute({sql:'DELETE FROM clientes WHERE id=?',args:[customerId],wantRows:false});
    await tx.execute({sql:'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',args:['ELIMINAR-CLIENTE-'+opId,'ELIMINAR-CLIENTE',opId,JSON.stringify({tipo:'ELIMINAR-CLIENTE',operationId:opId,referencia:customerId})],wantRows:false});
    return {customer,deletedDebts:debts.length};
  });
}

export async function createPurchaseTransaction(params:any){
  assertTursoReady(); const {operationId,purchase,items,purchaseDate,purchaseDateTime,supplier,invoiceNumber,exchangeRate,journal,debt}=params;
  if(!items?.length) throw new Error('La compra no contiene productos.'); if(!invoiceNumber||!supplier) throw new Error('La compra no tiene factura/proveedor.'); if(!(Number(exchangeRate)>0)) throw new Error('La tasa de la compra no es válida.'); if(!purchase?.id) throw new Error('La compra no tiene id.');
  const opId=String(operationId||purchase.id||(invoiceNumber+'|'+supplier+'|'+purchaseDate));
  return tursoInteractiveTransaction(async tx=>{
    if((await tx.execute({sql:'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',args:['COMPRA',opId]})).rows.length) throw new Error('Esta compra ya fue procesada. Evite duplicarla.');
    if((await tx.execute(txSelect('compras',String(purchase.id)))).rows.length) throw new Error('Esta compra ya existe en Turso.');
    const existing=await tx.execute({sql:"SELECT id,data_json FROM compras WHERE json_extract(data_json,'$.numeroFactura')=? AND json_extract(data_json,'$.proveedor')=?",args:[String(invoiceNumber),String(supplier)]});
    if(existing.rows.some((r:any)=>!purchaseDate||String(rowFromDb(r)?.fecha||'').slice(0,10)===String(purchaseDate).slice(0,10))) throw new Error('Ya existe una compra con la misma factura, proveedor y fecha.');
    const debtRows=await tx.execute({sql:"SELECT id,data_json FROM cxp WHERE json_extract(data_json,'$.numeroFactura')=? AND json_extract(data_json,'$.proveedor')=?",args:[String(invoiceNumber),String(supplier)]});
    if(debtRows.rows.some((r:any)=>!purchaseDate||String(rowFromDb(r)?.fecha||'').slice(0,10)===String(purchaseDate).slice(0,10))) throw new Error('Ya existe una cuenta por pagar para esta factura y proveedor.');
    const ids=[...new Set(items.map((i:any)=>String(i.productoId||'')).filter(Boolean))], itemBy=new Map<string,any>(); for(const i of items){const pid=String(i.productoId),p=itemBy.get(pid);itemBy.set(pid,p?{...p,cantidad:(Number(p.cantidad)||0)+(Number(i.cantidad)||0),subtotalUSD:(Number(p.subtotalUSD)||0)+(Number(i.subtotalUSD)||0)}:{...i});}
    const statements:TursoStatement[]=[rowStatement('compras',purchase)];
    const updatedProducts:any[]=[];
    for(const pid of ids){const p=rowFromDb((await tx.execute(txSelect('productos',pid))).rows[0]);if(!p)throw new Error('El producto '+pid+' ya no existe en Turso.');const i=itemBy.get(pid),qty=Number(i.cantidad)||0,cost=Number(i.costoUnitarioUSD)||0,oldStock=Number(p.stock)||0,oldCost=Number(p.costoUSD)||0,newStock=oldStock+qty,newCost=newStock>0?Math.round((((oldStock*oldCost)+(qty*cost))/newStock+Number.EPSILON)*10000)/10000:cost;
      const latestRow=(await tx.execute({sql:"SELECT id,data_json FROM movimientos WHERE json_extract(data_json,'$.productoId')=? ORDER BY fecha DESC,id DESC LIMIT 1",args:[pid]})).rows[0]; const latest=latestRow?rowFromDb(latestRow):null; const mv={id:String(items.find((x:any)=>String(x.productoId)===pid)?.movementId||('MOV-'+crypto.randomUUID())),productoId:pid,tipo:'compra',cantidad:qty,costoUnitarioUSD:cost,subtotalUSD:Number(i.subtotalUSD)||qty*cost,stockAntes:0,stockDespues:0,fecha:purchaseDateTime,referencia:`COMPRA FACT: ${invoiceNumber} - PROV: ${supplier}`,terminalId:String(purchase.terminalId||'ADMIN')}; const latestFecha=String(latest?.fecha||''); const compraEsCronologicamenteUltima=!latestFecha||String(purchaseDateTime||'')>=latestFecha; if(compraEsCronologicamenteUltima){mv.stockAntes=oldStock;mv.stockDespues=newStock;statements.push(rowStatement('movimientos',mv));}else{const rows=(await tx.execute({sql:"SELECT id,data_json FROM movimientos WHERE json_extract(data_json,'$.productoId')=? ORDER BY fecha ASC,id ASC",args:[pid]})).rows.map(rowFromDb); const combined=[...rows.map((d:any)=>({id:d.id,data:d})),{id:mv.id,data:mv}].sort((a:any,b:any)=>String(a.data.fecha||'').localeCompare(String(b.data.fecha||''))); let running=rows.length?Number(rows[0].stockAntes)||0:0; for(const e of combined){const before=running;running=before+(Number(e.data.cantidad)||0);statements.push(rowStatement('movimientos',{...e.data,id:e.id,stockAntes:before,stockDespues:running}));}} statements.push(rowStatement('productos',{...p,id:pid,stock:newStock,costoUSD:newCost}));}
    if(debt?.id) statements.push(rowStatement('cxp',debt)); if(journal?.id) statements.push(rowStatement('libroDiario',journal)); statements.push({sql:'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',args:['COMPRA-'+opId,'COMPRA',opId,JSON.stringify({tipo:'COMPRA',operationId:opId,referencia:purchase.id})],wantRows:false}); if(statements.length>450)throw new Error('La compra tiene demasiados movimientos históricos para una sola transacción.'); for(const s of statements)await tx.execute(s); return {purchase,journal:journal||null,debt:debt||null,products:updatedProducts};
  });
}
export async function deletePurchaseTransaction(params:any){
  assertTursoReady();
  const {operationId,purchaseId,invoiceNumber,supplier,purchaseDate}=params;
  if(!invoiceNumber||!supplier) throw new Error('La compra no tiene factura/proveedor identificables.');
  const opId=String(operationId||invoiceNumber+'|'+supplier+'|'+String(purchaseDate||'').slice(0,10)+'|DELETE');

  return tursoInteractiveTransaction(async tx=>{
    const previousDelete = await tx.execute({
      sql:'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',
      args:['ELIMINAR-COMPRA',opId]
    });
    // Si una ejecución anterior dejó la marca de idempotencia pero la compra
    // todavía existe, permitimos la recuperación con un nuevo operationId.
    // Solo una compra realmente inexistente se considera ya eliminada.
    const deleteOpId = previousDelete.rows.length
      ? opId + '|RECOVERY-' + crypto.randomUUID()
      : opId;

    const purchase=purchaseId?rowFromDb((await tx.execute(txSelect('compras',purchaseId))).rows[0]):null;
    const purchases=(await tx.execute({
      sql:"SELECT id,data_json FROM compras WHERE json_extract(data_json,'$.numeroFactura')=? AND json_extract(data_json,'$.proveedor')=?",
      args:[String(invoiceNumber),String(supplier)]
    })).rows.map(rowFromDb).filter((d:any)=>!purchaseDate||String(d.fecha||'').slice(0,10)===String(purchaseDate).slice(0,10));

    const debts=(await tx.execute({
      sql:"SELECT id,data_json FROM cxp WHERE json_extract(data_json,'$.numeroFactura')=? AND json_extract(data_json,'$.proveedor')=?",
      args:[String(invoiceNumber),String(supplier)]
    })).rows.map(rowFromDb).filter((d:any)=>!purchaseDate||String(d.fecha||'').slice(0,10)===String(purchaseDate).slice(0,10));

    const purchaseJournals=(await tx.execute({
      sql:"SELECT id,data_json FROM libro_diario WHERE json_extract(data_json,'$.referencia')=?",
      args:[String(invoiceNumber)]
    })).rows.map(rowFromDb).filter((d:any)=>String(d.categoria||'')==='COMPRA');

    // Si la compra generó una CxP y luego recibió abonos, esos abonos también
    // generaron asientos contables. Al eliminar la compra se eliminan esos
    // asientos junto con la deuda para que no quede ningún efecto contable.
    const paymentJournalIds=[...new Set(
      debts.flatMap((d:any)=>Array.isArray(d.historialPagos)?d.historialPagos:[])
        .map((p:any)=>String(p?.asientoId||'').trim())
        .filter(Boolean)
    )];
    const paymentJournals=paymentJournalIds.length
      ? (await tx.execute({
          sql:`SELECT id,data_json FROM libro_diario WHERE id IN (${paymentJournalIds.map(()=>'?').join(',')})`,
          args:paymentJournalIds
        })).rows.map(rowFromDb)
      : [];
    const journals=[...purchaseJournals,...paymentJournals.filter((j:any)=>!purchaseJournals.some((p:any)=>String(p.id)===String(j.id)))];

    const purchaseReference=`COMPRA FACT: ${invoiceNumber} - PROV: ${supplier}`;
    const deleted=(await tx.execute({
      sql:"SELECT id,data_json FROM movimientos WHERE json_extract(data_json,'$.referencia')=?",
      args:[purchaseReference]
    })).rows.map(rowFromDb).filter((d:any)=>String(d.tipo||'')==='compra');

    if(!purchase&&!purchases.length&&!debts.length&&!deleted.length)
      throw new Error('La compra ya no existe en Turso.');

    const affected=[...new Set(deleted.map((d:any)=>String(d.productoId||'')).filter(Boolean))];
    const statements:TursoStatement[]=[];
    const updatedProducts:any[]=[];
    const updatedMovements:any[]=[];

    for(const pid of affected){
      const p=rowFromDb((await tx.execute(txSelect('productos',pid))).rows[0]);
      if(!p) continue;

      const rows=(await tx.execute({
        sql:"SELECT id,data_json FROM movimientos WHERE json_extract(data_json,'$.productoId')=? ORDER BY fecha ASC,id ASC",
        args:[pid]
      })).rows.map(rowFromDb);

      const deletedIds=new Set(deleted.filter((d:any)=>String(d.productoId)===pid).map((d:any)=>String(d.id)));
      const remaining=rows.filter((m:any)=>!deletedIds.has(String(m.id)));
      const deletedForProduct=deleted.filter((x:any)=>String(x.productoId)===pid);
      const latestMovementId=rows.length ? String(rows[rows.length-1].id) : '';
      const deletingLatestMovement=deletedForProduct.some((d:any)=>String(d.id)===latestMovementId);

      // Una compra nueva normalmente es el último movimiento. En ese caso NO
      // se debe reconstruir todo el Kardex histórico: basta eliminar el
      // movimiento de compra y actualizar el producto. Esto evita convertir
      // una eliminación sencilla en cientos/miles de escrituras.
      const rebuilt:any[]=[];
      if(!deletingLatestMovement){
        let running=remaining.length ? Number(remaining[0].stockAntes)||0 : 0;
        for(const m of remaining){
          const before=running;
          running=before+(Number(m.cantidad)||0);
          const rebuiltMovement={...m,stockAntes:before,stockDespues:running};
          rebuilt.push(rebuiltMovement);
          statements.push(rowStatement('movimientos',rebuiltMovement));
        }
      } else {
        rebuilt.push(...remaining);
      }

      for(const d of deletedForProduct)
        statements.push({sql:'DELETE FROM movimientos WHERE id=?',args:[d.id],wantRows:false});

      // El costo CPP debe quedar exactamente como estaba antes de la compra:
      // si quedan entradas de compra, se toma el CPP ponderado de las compras
      // restantes; de lo contrario se conserva el costo de un stock previo.
      const purchaseRows=rebuilt
        .filter((m:any)=>String(m.tipo||'')==='compra')
        .map((m:any)=>({
          qty:Number(m.cantidad)||0,
          cost:Number(m.costoUnitarioUSD ?? m.costoUSD ?? 0)||0,
          fecha:String(m.fecha||'')
        }))
        .filter((m:any)=>m.qty>0&&m.cost>0);

      const deletedItems=(purchases.length?purchases:purchase?[purchase]:[])
        .flatMap((pu:any)=>Array.isArray(pu.items)?pu.items:[])
        .filter((it:any)=>String(it.productoId||'')===pid);

      // El Kardex es la fuente de verdad del stock. Nunca debemos calcular
      // el stock final como "stock actual - cantidad eliminada", porque el
      // producto puede haber tenido ventas/consumos posteriores a la compra.
      // Si reconstruimos el Kardex, tomamos su último saldo; si la compra
      // eliminada era el último movimiento, tomamos el último saldo restante.
      const kardexFinalStock = rebuilt.length
        ? Number(rebuilt[rebuilt.length - 1].stockDespues)
        : 0;

      // Las compras históricas anteriores no guardaban costo en el movimiento.
      // Si el producto conserva stock, el CPP actual se reconstruye usando
      // el costo previo al momento de esta eliminación cuando está disponible.
      // Para compras creadas por el flujo actual, el snapshot de la compra sí
      // contiene el costo unitario y permite calcular el CPP restante con precisión.
      let finalCost=Number(p.costoUSD)||0;
      const currentStock=Number(p.stock)||0;
      const finalStock=Number.isFinite(kardexFinalStock)
        ? Math.max(0,kardexFinalStock)
        : currentStock;

      if(deletedItems.length && finalStock>0 && currentStock>0){
        const deletedCostTotal=deletedItems.reduce((s:number,it:any)=>s+(Number(it.cantidad)||0)*(Number(it.costoUnitarioUSD)||0),0);
        const beforeStock=finalStock;
        const currentValue=currentStock*finalCost;
        const beforeValue=Math.max(0,currentValue-deletedCostTotal);
        if(beforeStock>0) finalCost=Math.round((beforeValue/beforeStock+Number.EPSILON)*10000)/10000;
        else finalCost=0;
      }

      const updatedProduct={...p,id:pid,stock:finalStock,costoUSD:finalCost};
      statements.push(rowStatement('productos',updatedProduct));
      updatedProducts.push(updatedProduct);
      updatedMovements.push(...rebuilt);
    }

    for(const d of debts) statements.push({sql:'DELETE FROM cxp WHERE id=?',args:[d.id],wantRows:false});
    for(const j of journals) statements.push({sql:'DELETE FROM libro_diario WHERE id=?',args:[j.id],wantRows:false});
    for(const p of purchases) statements.push({sql:'DELETE FROM compras WHERE id=?',args:[p.id],wantRows:false});
    if(purchase?.id&&!purchases.some((p:any)=>String(p.id)===String(purchase.id)))
      statements.push({sql:'DELETE FROM compras WHERE id=?',args:[purchase.id],wantRows:false});

    statements.push({
      sql:'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',
      args:['ELIMINAR-COMPRA-'+deleteOpId,'ELIMINAR-COMPRA',deleteOpId,JSON.stringify({
        tipo:'ELIMINAR-COMPRA',operationId:deleteOpId,referencia:invoiceNumber,
        purchaseId:purchaseId||null
      })],
      wantRows:false
    });

    for(const s of statements) await tx.execute(s);

    const deletedPurchaseIds=[...new Set([
      ...purchases.map((p:any)=>String(p.id)),
      ...(purchase?.id?[String(purchase.id)]:[])
    ])];
    const deletedDebtIds=debts.map((d:any)=>String(d.id));
    const deletedJournalIds=journals.map((j:any)=>String(j.id));
    const deletedMovementIds=deleted.map((m:any)=>String(m.id));

    return {
      deletedMovements:deleted.length,
      deletedDebts:debts.length,
      deletedJournals:journals.length,
      deletedPurchase:purchases.length+(purchase&&!purchases.some((p:any)=>String(p.id)===String(purchase.id))?1:0),
      affectedProducts:affected.length,
      deletedPurchaseIds,
      deletedDebtIds,
      deletedJournalIds,
      deletedMovementIds,
      products:updatedProducts,
      movements:updatedMovements
    };
  });
}
export async function deleteCustomerDebtTransaction(params:any){
  assertTursoReady(); const {operationId,debtId,customerCedula,customerId}=params; const opId=String(operationId||debtId);
  return tursoInteractiveTransaction(async tx=>{ if((await tx.execute({sql:'SELECT id FROM operaciones WHERE prefijo=? AND operation_id=? LIMIT 1',args:['ELIMINAR-CXC',opId]})).rows.length)throw new Error('Esta operación ya fue procesada.'); const debt=rowFromDb((await tx.execute(txSelect('cxc',debtId))).rows[0]);if(!debt)throw new Error('La deuda ya no existe.');const saldo=Number(debt.saldoUSD)||0;let customer:any=null,customerRefId:any=null;if(customerId){customerRefId=customerId;customer=rowFromDb((await tx.execute(txSelect('clientes',customerId))).rows[0]);}else if(customerCedula){customer=rowFromDb((await tx.execute({sql:"SELECT id,data_json FROM clientes WHERE json_extract(data_json,'$.cedula')=? LIMIT 1",args:[String(customerCedula)]})).rows[0]);if(customer)customerRefId=customer.id;}const statements:TursoStatement[]=[{sql:'DELETE FROM cxc WHERE id=?',args:[debtId],wantRows:false}];if(customer&&customerRefId)statements.push(rowStatement('clientes',{...customer,debt:Math.max(0,(Number(customer.debt)||0)-saldo),id:customerRefId}));statements.push({sql:'INSERT INTO operaciones(id,prefijo,operation_id,data_json) VALUES(?,?,?,?)',args:['ELIMINAR-CXC-'+opId,'ELIMINAR-CXC',opId,JSON.stringify({tipo:'ELIMINAR-CXC',operationId:opId,referencia:debtId})],wantRows:false});for(const s of statements)await tx.execute(s);return {debt,customer:customer?{...customer,debt:Math.max(0,(Number(customer.debt)||0)-saldo)}:null};});
}
