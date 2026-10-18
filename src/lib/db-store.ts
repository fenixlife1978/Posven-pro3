'use client';

import { AppState, Terminal, Movimiento } from './types';
import { enqueueOfflineOperation, registerOfflineProcessor } from './offline-queue';
// Turso es la única base de datos operativa. Estos nombres se conservan únicamente
// para que los caminos legacy de sincronización no vuelvan a escribir en servidor Turso.
// Cualquier intento de alcanzar esos caminos falla explícitamente.
type DocumentData = any;
type QueryDocumentSnapshot<T = any> = any;
const db: any = null;
const rtdb: any = null;
const servidorTursoRetirado = (..._args: any[]): never => {
  throw new Error('servidor Turso fue retirado del flujo operativo. Turso es la única fuente de datos.');
};
const collection: any = servidorTursoRetirado;
const doc: any = servidorTursoRetirado;
const getDoc: any = servidorTursoRetirado;
const getDocs: any = servidorTursoRetirado;
const onSnapshot: any = servidorTursoRetirado;
const orderBy: any = servidorTursoRetirado;
const limit: any = servidorTursoRetirado;
const query: any = servidorTursoRetirado;
const setDoc: any = servidorTursoRetirado;
const where: any = servidorTursoRetirado;
const runTransaction: any = servidorTursoRetirado;
const startAfter: any = servidorTursoRetirado;
const onValue: any = servidorTursoRetirado;
const ref: any = servidorTursoRetirado;
const update: any = servidorTursoRetirado;
const rtdbGet: any = servidorTursoRetirado;

const STORAGE_KEY = 'posven_pro_session_data_cache';
const PAGE_SIZE = 50;
const CONFIG_COLLECTION = 'config';
const CONFIG_DOC_ID = 'general';
const CATALOGOS_COLLECTION = 'catalogos';
const RTDB_PRODUCTS_PATH = 'pos_system_data/productos';

// ============================================================
// UBICACIÓN EN FIRESTORE POR LISTA DEL ESTADO.
// Cada lista vive en SU PROPIA COLECCIÓN (documento por registro).
// El doc pos_system_data/state YA NO se lee ni se escribe.
// ============================================================
const COLLECTIONS: Record<string, string> = {
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
  libroDiario: 'libroDiario',
  reportesZ: 'reportesZ',
  cashHistory: 'caja',
  compras: 'compras',
};

// Catálogos: viven como docs catalogos/{nombre} con { lista: [...] }
const OPERATIONS_COLLECTION = 'operaciones';

// ============================================================
// PUENTE DE OPERACIONES CRÍTICAS A TURSO
// ------------------------------------------------------------
// Turso solo toma el control cuando sus credenciales existen en el servidor.
// Si no está configurado (HTTP 503), el flujo existente de servidor Turso continúa.
// Si Turso sí está configurado pero falla por otra causa, NO hacemos fallback
// a servidor Turso: evitar dos fuentes de verdad es obligatorio durante la migración.
// ============================================================
async function tryTursoOperation(operation: string, payload: any): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('El dispositivo está sin conexión. La operación no se enviará a servidor Turso para evitar duplicados.');
  let response: Response;
  try {
    response = await fetch('/api/turso/store', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ operation, ...payload }),
    });
  } catch {
    throw new Error('No se pudo contactar con Turso. La operación no fue enviada a servidor Turso para evitar duplicados.');
  }
  if (response.status === 503) throw new Error('Turso no está configurado o no está disponible. servidor Turso no se utilizará como respaldo.');
  let body: any = null;
  try { body = await response.json(); } catch {}
  if (!response.ok || body?.ok === false) throw new Error(String(body?.error || ('Turso rechazó la operación (' + response.status + ').')));
  return body;
}

async function tryTursoSpecialRead(kind: 'config' | 'catalog', name = ''): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams({ special: kind });
  if (kind === 'catalog') params.set('name', name);
  let response: Response;
  try { response = await fetch('/api/turso/store?' + params.toString(), { credentials: 'include', cache: 'no-store' }); }
  catch { throw new Error('No se pudo consultar Turso.'); }
  if (response.status === 503) throw new Error('Turso no está configurado o no está disponible. servidor Turso no se utilizará como respaldo.');
  let body: any = null; try { body = await response.json(); } catch {}
  if (!response.ok || body?.ok === false) throw new Error(String(body?.error || 'Turso rechazó la lectura.'));
  return kind === 'config' ? (body.config || {}) : (Array.isArray(body.lista) ? body.lista : []);
}
async function tryTursoRead(table: string, options: { limit?: number; terminalId?: string; estado?: string } = {}): Promise<any[] | null> {
  if (typeof window === 'undefined') return null;
  let response: Response;
  try {
    const params = new URLSearchParams();
    params.set('table', table);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.terminalId) params.set('terminalId', String(options.terminalId));
    if (options.estado) params.set('estado', String(options.estado));
    response = await fetch('/api/turso/store?' + params.toString(), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    throw new Error('No se pudo consultar Turso. No se usará servidor Turso como respaldo porque Turso está activo.');
  }
  if (response.status === 503) throw new Error('Turso no está configurado o no está disponible. servidor Turso no se utilizará como respaldo.');
  let body: any = null;
  try { body = await response.json(); } catch {}
  if (!response.ok || body?.ok === false) {
    throw new Error(String(body?.error || ('Turso rechazó la lectura (' + response.status + ').')));
  }
  return Array.isArray(body?.records) ? body.records : [];
}


function operationDocId(prefix: string, operationId: string): string {
  const input = prefix + '|' + operationId;
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return prefix.slice(0, 20) + '-' + (h >>> 0).toString(36);
}

async function claimOperation(tx: any, prefix: string, operationId: string): Promise<any> {
  const ref = doc(db, OPERATIONS_COLLECTION, operationDocId(prefix, operationId));
  const snap = await tx.get(ref);
  if (snap.exists()) throw new Error('Esta operación ya fue procesada. No se registrará nuevamente.');
  return ref;
}


function terminalPrefix(terminal: any, terminalId?: string): string {
  const raw = String(terminal?.prefijoCaja || '').trim().toUpperCase();
  if (raw) return raw;
  if (terminalId) return 'C-' + String(terminalId).replace(/[^A-Z0-9]/gi, '').slice(-6).toUpperCase();
  return 'GLOBAL';
}

function terminalSeries(prefix: string, label: string, number: number, width = 6): string {
  return prefix + '-' + label + '-' + String(number).padStart(width, '0');
}

const CATALOG_CACHE_META_KEY = 'posven_pro_catalog_cache_meta_v1';

const CATALOG_FIELDS: Record<string, string> = {
  categorias: 'categorias',
  departamentos: 'departamentos',
  marcas: 'marcas',
  presentaciones: 'presentaciones',
  productCategories: 'productCategories',
  productUnits: 'productUnits',
  productColors: 'productColors',
  productSizes: 'productSizes',
  brands: 'brands',
  groups: 'groups',
  subgroups: 'subgroups',
  lines: 'lines',
  suppliers: 'suppliers',
};

// Campos de configuración que se guardan en config/general (nunca en state).
// NOTA: El estado de caja (isCashOpen, cashData, fondos, ultimoZ, fechaUltimoZ,
// acumuladoHistorico, cashHistory) NO vive aquí: es POR TERMINAL (por caja),
// y se guarda en cada documento de la colección `terminales`. Eso evita que dos
// cajas compartan apertura/corte Z y se pisen la información entre sí.
const CONFIG_FIELDS = [
  'tasa', 'pinDevolucion', 'isInitialized', 'empresa',
  'proximoRecibo', 'proximaDevolucion', 'proximaAnulacion', 'config',
];

export const initialState: AppState = {
  user: null,
  isAuthenticated: false,
  tasa: 36.50,
  pinDevolucion: '000000',
  isInitialized: false,
  productos: [],
  ventas: [],
  cxc: [],
  cxp: [],
  clientes: [],
  devoluciones: [],
  anulaciones: [],
  movimientos: [],
  libroDiario: [],
  carrito: [],
  terminales: [],
  reportesZ: [],
  ultimoZ: 0,
  proximoRecibo: 1,
  proximaDevolucion: 1,
  proximaAnulacion: 1,
  acumuladoHistorico: 0,
  fechaUltimoZ: '',
  fondoCajaHoyUSD: 0,
  fondoCajaHoyBS: 0,

  isCashOpen: false,
  cashData: null,
  cashHistory: [],

  empresa: {
    nombre: 'NOMBRE DE SU NEGOCIO',
    rif: 'J-00000000-0',
    direccion: 'DIRECCIÓN FISCAL',
    telefono: '0000-0000000'
  },
  departamentos: ['Licores', 'Viveres', 'Otros'],
  categorias: ['Ron', 'Vino', 'Cerveza', 'Whisky', 'Refrescos', 'Otros'],
  marcas: ['Genérica'],
  presentaciones: ['750ml', '1L', 'Unidad', 'Caja'],
  proveedores: [],
  compras: [],

  config: {
    exchangeRate: 36.50,
    ivaRate: 16,
    igtfRate: 3
  },

  productCategories: ['Repuesto', 'Lubricante', 'Filtro', 'Químico', 'Accesorio', 'Batería', 'Caucho', 'Freno', 'Suspensión', 'Motor', 'Eléctrico', 'Transmisión', 'Servicio'],
  productUnits: ['unidad', 'litro', 'galón', 'cuarto', 'paila', 'kit', 'juego', 'par', 'metro', 'kilogramo', 'gramo', 'tambor'],
  productColors: ['No Aplica', 'Negro', 'Gris', 'Cromo', 'Rojo', 'Azul', 'Blanco', 'Ámbar'],
  productSizes: ['N/A', 'Estándar', '0.10', '0.20', '0.30', '0.40', '0.50', '20', '30', '40', '50', '60'],

  brands: [],
  groups: [],
  subgroups: [],
  lines: [],
  suppliers: [],

  marcasString: ['Genérica'],
  proveedoresString: [],

  products: [],
};

// ============================================================
// CACHE EN MEMORIA + localStorage (SOLO para mostrar UI rápido).
// El cache NUNCA se sube a Firestore (no más sobrescritura de datos).
//
// ⚠️ localStorage (no sessionStorage): la sesión debe sobrevivir
// cortes de luz / reinicios del PC. Si sessionStorage se usa, el cache
// se borra al cerrar el navegador y los Reportes X/Z se generan vacíos
// al volver a abrir el sistema (bug reportado por usuario).
// ============================================================
function readSession(): Partial<AppState> {
  if (typeof window === 'undefined') return {};
  try {
    const d = localStorage.getItem(STORAGE_KEY);
    if (!d) return {};
    const parsed = JSON.parse(d) as Partial<AppState>;
    delete (parsed as any).carrito;
    return parsed;
  } catch { return {}; }
}

let cache: AppState = { ...initialState, ...readSession() } as AppState;
const listeners = new Set<(s: Partial<AppState>) => void>();

// Mide cuánto ocupa el cache serializado; si pasa de ~4MB deja de escribir
// a localStorage para no tumbar la app (el cache en memoria sigue activo).
const LOCALSTORAGE_SOFT_LIMIT = 4 * 1024 * 1024; // 4 MB

function applyPatch(patch: Partial<AppState>) {
  cache = { ...cache, ...patch } as AppState;
  if (typeof window !== 'undefined') {
    try {
      const cacheToSave = { ...cache };
      delete (cacheToSave as any).carrito;
      const serialized = JSON.stringify(cacheToSave);
      if (serialized.length <= LOCALSTORAGE_SOFT_LIMIT) {
        localStorage.setItem(STORAGE_KEY, serialized);
      } else {
        // Excede el límite: no escribimos para evitar QuotaExceededError.
        // La próxima vez que se llame a readSession() se seguirá usando lo
        // último que cupo, pero el cache en memoria sigue 100% funcional.
        console.warn(
          '[db-store] Cache excede ' + (LOCALSTORAGE_SOFT_LIMIT / 1024 / 1024) +
          'MB, se omite escritura a localStorage (cuota llena).'
        );
      }
    } catch (e: any) {
      // QuotaExceededError u otro: no tumbamos la app.
      console.warn('[db-store] No se pudo persistir cache en localStorage:', e?.message || e);
    }
  }
  listeners.forEach(cb => { try { cb(patch); } catch (e) { console.error(e); } });
}

// Firestore rechaza undefined (y NaN/Infinity): los normaliza para no tumbar la escritura.
function sanitizeForFirestore(value: any): any {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForFirestore).filter(v => v !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) {
      const v = sanitizeForFirestore(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return value;
}

// Une dos listas por id sin duplicados (mantiene los elementos locales aún no persistidos).
function mergeById<T extends { id?: any }>(existing: T[] | undefined, incoming: T[]): T[] {
  const map = new Map<string, T>();
  (existing || []).forEach(x => { if (x && x.id !== undefined) map.set(String(x.id), x); });
  incoming.forEach(x => { if (x && x.id !== undefined) map.set(String(x.id), x); });
  return [...map.values()];
}

// Persistencia optimista por documento.
// Antes de sobrescribir un registro existente se comprueba dentro de una
// transacción que Firestore siga teniendo exactamente la versión que esta
// caja leyó. Si otra caja lo cambió entretanto, abortamos en lugar de
// pisar silenciosamente su modificación con un array local antiguo.
async function syncArrayToCollection(name: string, prevArr: any[] | undefined, newArr: any[] | undefined): Promise<void> {
  const previousIds = new Set((prevArr || []).filter(x => x && x.id).map(x => String(x.id)));
  const records = (newArr || []).filter(x => x && x.id).map(sanitizeForFirestore);
  const currentIds = new Set(records.map((x: any) => String(x.id)));
  const deletedIds = [...previousIds].filter(id => !currentIds.has(id));
  if (records.length === 0 && deletedIds.length === 0) return;
  const result = await tryTursoOperation('recordsSync', { table: name, records, deletedIds });
  if (result && Array.isArray(result.records)) applyPatch({ [name]: result.records });
}

// Stock y movimientos se gestionan exclusivamente mediante operaciones transaccionales de Turso.
function syncProductosTransactional(_prevArr: any[] | undefined, _newArr: any[] | undefined): Promise<Map<string, number> | undefined> {
  throw new Error('La persistencia de productos está gestionada exclusivamente por Turso.');
}

// Movimiento de inventario atómico: toma el stock REAL de Firestore y registra
// el movimiento con stockAntes/stockDespues calculados dentro de la transacción.
async function applyInventoryMovementsTransaction(params: {
  operationId: string;
  operationType: string;
  movements: any[];
  productPatches?: Record<string, any>;
  fromOfflineQueue?: boolean;
}): Promise<any> {
  const tursoResult = await tryTursoOperation('inventory', params);
  if (tursoResult) {
    if (Array.isArray(tursoResult.products) && tursoResult.products.length) applyPatch({ productos: mergeById(cache.productos, tursoResult.products) });
    if (Array.isArray(tursoResult.movements) && tursoResult.movements.length) applyPatch({ movimientos: mergeById(cache.movimientos, tursoResult.movements) });
    return tursoResult;
  }

  const { operationId, operationType, movements, productPatches = {}, fromOfflineQueue } = params;
  if (!movements?.length) throw new Error('No hay movimientos de inventario para registrar.');

  if (!fromOfflineQueue && typeof window !== 'undefined' && navigator.onLine === false) {
    if (!['AJUSTE-INVENTARIO', 'AJUSTE-INVENTARIO-POS'].includes(operationType)) {
      throw new Error('Esta operación requiere conexión para proteger la consistencia de ventas/devoluciones.');
    }
    enqueueOfflineOperation('INVENTARIO', { operationId, operationType, movements, productPatches, fromOfflineQueue: true }, operationId);
    return { queuedOffline: true, operationId, movements, products: [] };
  }

  const productIds = [...new Set(movements.map(m => String(m.productoId || '')).filter(Boolean))];
  let result: any = null;
  await runTransaction(db, async tx => {
    const operationRef = await claimOperation(tx, operationType, operationId);
    const remoteProducts = new Map<string, any>();
    for (const pid of productIds) {
      const snap = await tx.get(doc(db, 'productos', pid));
      if (!snap.exists()) throw new Error('El producto ' + pid + ' ya no existe en Firestore.');
      remoteProducts.set(pid, { ...sanitizeForFirestore(snap.data()), id: pid });
    }

    if (movements.length + productIds.length + 1 > 450) {
      throw new Error('La operación contiene demasiados movimientos para una sola transacción.');
    }

    const byProduct = new Map<string, any[]>();
    movements.forEach(m => {
      const pid = String(m.productoId);
      const list = byProduct.get(pid) || [];
      list.push(m);
      byProduct.set(pid, list);
    });

    const persisted: any[] = [];
    const persistedProducts: any[] = [];
    for (const pid of productIds) {
      const product = remoteProducts.get(pid);
      let running = Number(product.stock) || 0;
      for (const movement of byProduct.get(pid) || []) {
        const delta = Number(movement.cantidad) || 0;
        const before = running;
        running = before + delta;
        const persistedMovement = {
          ...movement,
          productoId: pid,
          stockAntes: before,
          stockDespues: running,
          id: String(movement.id || Store.uid())
        };
        tx.set(doc(db, 'movimientos', persistedMovement.id), sanitizeForFirestore(persistedMovement), { merge: false });
        persisted.push(persistedMovement);
      }

      const patch = productPatches[pid] || {};
      const persistedProduct = { ...product, ...patch, stock: running };
      tx.set(doc(db, 'productos', pid), sanitizeForFirestore(persistedProduct), { merge: true });
      persistedProducts.push(persistedProduct);
    }

    tx.set(operationRef, {
      tipo: operationType,
      operationId,
      fecha: String(movements[0]?.fecha || Utils.ahora()),
      referencia: String(movements[0]?.referencia || operationId)
    }, { merge: false });
    result = { movements: persisted, productIds, products: persistedProducts };
  });
  if (result?.products?.length) {
    await syncProductosRTDB([], result.products);
  }
  return result;
}

// ============================================================
// ESPEJO EN TIEMPO REAL (RTDB) PARA PRODUCTOS.
// El stock/precios viven en RTDB para sincronizar cajas sin re-leer
// toda la colección de Firestore en cada cambio (gran ahorro de lecturas).
// Firestore sigue siendo la fuente de verdad persistente.
// ============================================================
function syncProductosRTDB(prevArr: any[] | undefined, newArr: any[] | undefined): Promise<void> {
  if (!rtdb) return Promise.resolve();
  const prevById = new Map((prevArr || []).filter(x => x && x.id).map(x => [String(x.id), x]));
  const newList = newArr || [];
  const updates: Record<string, any> = {};
  const removals: string[] = [];
  newList.forEach(p => {
    if (!p || !p.id) return;
    const before = prevById.get(String(p.id));
    const clean = sanitizeForFirestore(p);
    if (!before || JSON.stringify(sanitizeForFirestore(before)) !== JSON.stringify(clean)) {
      updates[String(p.id)] = clean;
    }
  });
  prevById.forEach((_x, id) => {
    if (!newList.some(p => p && String(p.id) === id)) removals.push(id);
  });
  if (Object.keys(updates).length === 0 && removals.length === 0) return Promise.resolve();
  // RTDB permite enviar actualizaciones y eliminaciones en un único update
  // multipath. Así una operación que elimina varios productos no genera un
  // write remoto independiente por cada producto.
  const rootRef = ref(rtdb, RTDB_PRODUCTS_PATH);
  const payload: Record<string, any> = { ...updates };
  removals.forEach(id => { payload[id] = null; });
  return update(rootRef, payload)
    .catch(e => console.error('RTDB sync productos:', e));
}

// Sincroniza el espejo RTDB con Firestore (migración y sanado):
//  - Si el espejo está vacío → lo siembra COMPLETO desde Firestore.
//  - Si está incompleto (menos productos que Firestore) → lo repuebla completo.
// Firestore sigue siendo la fuente de verdad; RTDB es el espejo barato de tiempo real.
async function bootstrapProductos(): Promise<boolean> {
  try {
    const tursoItems = await tryTursoRead('productos', { limit: 5000 });
    if (tursoItems !== null) {
      applyPatch({ productos: tursoItems });
      return true;
    }
    if (!rtdb) return false;
    const snap = await rtdbGet(ref(rtdb, RTDB_PRODUCTS_PATH));
    const val = snap.val();
    const mirrorItems: any[] = val ? Object.values(val).filter(Boolean) : [];

    if (mirrorItems.length === 0) {
      const items = await loadCollection('productos');
      if (items.length > 0) {
        applyPatch({ productos: mergeById((cache as any).productos, items) });
        const updates: Record<string, any> = {};
        items.forEach(p => { updates[String(p.id)] = sanitizeForFirestore(p); });
        await update(ref(rtdb, RTDB_PRODUCTS_PATH), updates);
      }
      return false;
    }

    applyPatch({ productos: mergeById((cache as any).productos, mirrorItems) });
    return false;
  } catch (e) {
    console.error('bootstrapProductos:', e);
    return false;
  }
}
// ============================================================
// LECTURAS
// ============================================================
const loadedAll: Record<string, boolean> = {};
const cursors: Record<string, QueryDocumentSnapshot<DocumentData> | null> = {};

async function loadCollection(name: string): Promise<any[]> {
  const tursoItems = await tryTursoRead(name);
  if (tursoItems !== null) return tursoItems.map(sanitizeForFirestore).filter(Boolean);
  if (!db) return [];
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => sanitizeForFirestore(d.data())).filter(Boolean);
}

// Carga COMPLETA de una colección paginada de 500 (evita leer doc a doc en loops).
async function loadAll(name: string): Promise<void> {
  if (loadedAll[name]) return;
  loadedAll[name] = true;
  if (!COLLECTIONS[name]) return;
  try {
    const items = await loadCollection(name);
    applyPatch({ [name]: items });
  } catch (e) {
    console.error("Error loadAll " + name + ":", e);
    loadedAll[name] = false;
  }
}

// Carga completa "bajo demanda" (para módulos que necesitan todo: reportes, kardex, contabilidad).
// Trackea la promesa en curso para que múltiples llamadas concurrentes
// compartan la misma carga (evita que la segunda retorne "ya cargado"
// cuando en realidad la primera aún no terminó — race condition que
// causaba Reportes X/Z en $0 tras reinicio).
const loadingPromises: Record<string, Promise<void>> = {};
async function ensureLoaded(name: string): Promise<void> {
  if (loadedAll[name]) return;
  if (loadingPromises[name]) return loadingPromises[name];
  if (typeof window === 'undefined') return;
  const p = (async () => {
    loadedAll[name] = true;
    try {
      const items = await loadCollection(name);
      applyPatch({ [name]: items });
    } catch (e) {
      console.error("Error cargando " + name + ":", e);
      loadedAll[name] = false;
      throw e;
    } finally {
      delete loadingPromises[name];
    }
  })();
  loadingPromises[name] = p;
  return p;
}

// Garantiza que TODAS las colecciones necesarias para los Reportes X/Z
// estén cargadas antes de generar el reporte. Evita la race condition
// donde el usuario abre X/Z justo después de un reinicio y el cache
// aún no terminó de hidratarse desde Firestore (resultados en $0).
// Como cada caja filtra por SU PROPIO `fechaUltimoZ` (per-terminal), ventas y
// libroDiario se cargan COMPLETOS: una caja nunca debe perder datos porque
// otra hizo su corte Z.
async function loadReportWindow(name: string, terminalId: string, cutoff: string): Promise<void> {
  const key = `report:${name}:${terminalId}:${cutoff}`;

  try {
    // Turso es la fuente operativa durante la migración. No debemos volver a
    // consultar servidor Turso para X/Z porque eso agrega latencia y puede devolver
    // un estado histórico distinto al de la caja actual.
    const tursoItems = await tryTursoRead(name, { limit: 2000, terminalId });
    if (tursoItems !== null) {
      const items = tursoItems
        .filter((item: any) => String(item?.fecha || '') > cutoff)
        .filter((item: any) => name !== 'ventas' && name !== 'libroDiario' || String(item?.terminalId || '') === terminalId);
      if (items.length) applyPatch({ [name]: mergeById((cache as any)[name], items) });
      SINCE_STAMP[key] = 'done';
      console.info("[db-store] Ventana Turso de reporte cargada:", name, items.length, "registros");
      return;
    }

    // Fallback únicamente cuando Turso no está configurado (503).
    if (!db || !COLLECTIONS[name]) return;
    const filters: any[] = [where('fecha', '>', cutoff)];
    if (name === 'ventas' || name === 'libroDiario') {
      filters.push(where('terminalId', '==', terminalId));
    }

    let cursor: QueryDocumentSnapshot | null = null;
    while (true) {
      const pageQuery = cursor
        ? query(collection(db, COLLECTIONS[name]), ...filters, orderBy('fecha', 'asc'), startAfter(cursor), limit(1000))
        : query(collection(db, COLLECTIONS[name]), ...filters, orderBy('fecha', 'asc'), limit(1000));
      let snap;
      try {
        snap = await getDocs(pageQuery);
      } catch (e: any) {
        if (e?.code !== 'failed-precondition' || name === 'devoluciones') throw e;
        const fallbackFilters: any[] = [where('fecha', '>', cutoff)];
        const fallbackQuery = cursor
          ? query(collection(db, COLLECTIONS[name]), ...fallbackFilters, orderBy('fecha', 'asc'), startAfter(cursor), limit(1000))
          : query(collection(db, COLLECTIONS[name]), ...fallbackFilters, orderBy('fecha', 'asc'), limit(1000));
        snap = await getDocs(fallbackQuery);
      }
      const items = snap.docs.map(d => sanitizeForFirestore(d.data())).filter(Boolean)
        .filter((item: any) => name !== 'ventas' && name !== 'libroDiario' || String(item.terminalId || '') === terminalId);
      if (items.length) applyPatch({ [name]: mergeById((cache as any)[name], items) });
      if (snap.docs.length < 1000) break;
      cursor = snap.docs[snap.docs.length - 1];
    }
    SINCE_STAMP[key] = 'done';
  } catch (e) {
    console.error("Error cargando ventana de reporte " + name + ":", e);
    throw e;
  }
}

// Reportes X/Z solo necesitan el período posterior al último Z de ESTA caja.
// No tiene sentido descargar ventas/libroDiario históricos de todas las cajas.
async function ensureReportData(terminalId?: string, cutoff?: string): Promise<void> {

  const termId = String(terminalId || '').trim();
  const desde = String(cutoff || '');

  // Si no tenemos terminal/corte (casos administrativos), conservamos el
  // comportamiento seguro anterior.
  if (!terminalId || !cutoff) {
    await Promise.all([
      ensureLoaded('ventas'),
      ensureLoaded('devoluciones'),
      ensureLoaded('libroDiario'),
    ]);
    return;
  }

  await Promise.all([
    loadReportWindow('ventas', termId, desde),
    loadReportWindow('devoluciones', termId, desde),
    loadReportWindow('libroDiario', termId, desde),
  ]);
}

async function ensureReportRange(name: string, desde: string, hasta: string, terminalId = 'all'): Promise<void> {
  if (!desde || !hasta) return;
  const key = `report-range:${name}:${terminalId}:${desde}:${hasta}`;
  if (SINCE_STAMP[key] === 'done') return;

  try {
    // En Turso evitamos las consultas compuestas de servidor Turso para el historial.
    const tursoItems = await tryTursoRead(name, { limit: 2000, ...(terminalId !== 'all' ? { terminalId } : {}) });
    if (tursoItems !== null) {
      const start = String(desde) + 'T00:00:00';
      const endDate = new Date(String(hasta) + 'T00:00:00');
      endDate.setDate(endDate.getDate() + 1);
      const end = endDate.toISOString().slice(0, 19);
      const items = tursoItems.filter((item: any) => {
        const fecha = String(item?.fecha || '');
        const terminalOk = terminalId === 'all' || String(item?.terminalId || '') === terminalId;
        return fecha >= start && fecha < end && terminalOk;
      });
      if (items.length) applyPatch({ [name]: mergeById((cache as any)[name], items) });
      SINCE_STAMP[key] = 'done';
      return;
    }

    if (!db || !COLLECTIONS[name]) return;
    const start = String(desde) + 'T00:00:00.000';
    const endDate = new Date(String(hasta) + 'T00:00:00.000');
    endDate.setDate(endDate.getDate() + 1);
    const end = endDate.toISOString().slice(0, 23);
    const filters: any[] = [where('fecha', '>=', start), where('fecha', '<', end)];
    if (terminalId !== 'all') filters.push(where('terminalId', '==', terminalId));

    let cursor: QueryDocumentSnapshot | null = null;
    while (true) {
      const q = cursor
        ? query(collection(db, COLLECTIONS[name]), ...filters, orderBy('fecha', 'asc'), startAfter(cursor), limit(1000))
        : query(collection(db, COLLECTIONS[name]), ...filters, orderBy('fecha', 'asc'), limit(1000));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => sanitizeForFirestore(d.data())).filter(Boolean);
      if (items.length) applyPatch({ [name]: mergeById((cache as any)[name], items) });
      if (snap.docs.length < 1000) break;
      cursor = snap.docs[snap.docs.length - 1];
    }
    SINCE_STAMP[key] = 'done';
  } catch (e) {
    console.error("Error cargando rango de reportes " + name + ":", e);
    throw e;
  }
}

// Siguiente página (10) de una colección ordenada por fecha desc (listas históricas).
async function loadMore(name: string, pageSize: number = PAGE_SIZE): Promise<number> {
  const col = COLLECTIONS[name];
  if (!col) return 0;
  try {
    const tursoItems = await tryTursoRead(name, { limit: pageSize });
    if (tursoItems !== null) {
      applyPatch({ [name]: mergeById((cache as any)[name], tursoItems) });
      return tursoItems.length;
    }
    if (!db) return 0;
    const last = cursors[name] || null;
    const q = last
      ? query(collection(db, col), orderBy('fecha', 'desc'), startAfter(last), limit(pageSize))
      : query(collection(db, col), orderBy('fecha', 'desc'), limit(pageSize));
    const snap = await getDocs(q);
    const items = snap.docs.map(d => sanitizeForFirestore(d.data())).filter(Boolean);
    cursors[name] = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
    applyPatch({ [name]: mergeById((cache as any)[name], items) });
    return items.length;
  } catch (e) {
    console.error("loadMore " + name + ":", e);
    return 0;
  }
}

const SINCE_STAMP: Record<string, string> = {};

// Kardex de un producto (where + orden). Si falta el índice compuesto, carga y filtra en memoria.
async function kardex(productoId: string, max = 100): Promise<any[]> {
  try {
    const tursoItems = await tryTursoRead('movimientos', { limit: Math.max(max * 4, max) });
    if (tursoItems !== null) {
      return tursoItems
        .filter((m: any) => String(m?.productoId || '') === String(productoId))
        .sort((a: any, b: any) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
        .slice(0, max);
    }
    if (!db) return [];
    try {
      const snap = await getDocs(query(
        collection(db, 'movimientos'),
        where('productoId', '==', productoId),
        orderBy('fecha', 'desc'),
        limit(max)
      ));
      return snap.docs.map(d => sanitizeForFirestore(d.data())).filter(Boolean);
    } catch (e: any) {
      if (e?.code === 'failed-precondition' || /index/i.test(String(e?.message || ''))) {
        await ensureLoaded('movimientos');
        return (cache.movimientos || [])
          .filter(m => m.productoId === productoId)
          .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
          .slice(0, max);
      }
      throw e;
    }
  } catch (e) {
    console.error("kardex " + productoId + ":", e);
    return [];
  }
}
function readCatalogCacheMeta(): { ready: boolean; version: string } {
  if (typeof window === 'undefined') return { ready: false, version: '' };
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_META_KEY);
    if (!raw) return { ready: false, version: '' };
    const parsed = JSON.parse(raw);
    return {
      ready: parsed?.ready === true,
      version: String(parsed?.version || '')
    };
  } catch {
    return { ready: false, version: '' };
  }
}

function writeCatalogCacheMeta(version: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CATALOG_CACHE_META_KEY, JSON.stringify({
      ready: true,
      version: String(version || ''),
      updatedAt: Date.now()
    }));
  } catch {
    // La caché principal sigue funcionando aunque localStorage no esté disponible.
  }
}

async function loadCatalogs(force = false, version = ''): Promise<void> {
  const meta = readCatalogCacheMeta();
  if (!force && meta.ready && (!version || meta.version === version)) return;
  const entries = Object.entries(CATALOG_FIELDS);
  const patch: any = {};
  let tursoActive = false;
  for (const [field, catName] of entries) {
    const list = await tryTursoSpecialRead('catalog', catName);
    if (list === null) break;
    tursoActive = true; patch[field] = list;
  }
  if (!tursoActive) {
    const results = await Promise.all(entries.map(async ([field, catName]) => {
      try { const snap = await getDoc(doc(db, CATALOGOS_COLLECTION, catName)); return [field, snap.exists() ? (snap.data().lista || []) : []] as const; }
      catch (e) { console.warn('Catálogo ' + catName + ':', e); return null; }
    }));
    results.forEach(result => { if (result) patch[result[0]] = result[1]; });
  }
  if (Object.keys(patch).length > 0) applyPatch(patch);
  writeCatalogCacheMeta(version || meta.version);
}
// ============================================================
// INICIALIZACIÓN DE LISTENERS
// ============================================================
let started = false;
let teardownFns: (() => void)[] = [];
const masterSyncFns: Record<string, () => void> = {};
const terminalSyncFns: Record<string, () => void> = {};

function stopTerminalSync(): void {
  for (const key of ['main', 'sales']) {
    const unsub = terminalSyncFns[key];
    if (unsub) {
      try { unsub(); } catch (e) { console.error(e); }
      delete terminalSyncFns[key];
    }
  }
}

function startTerminalSync(terminalId?: string, all = false, initialItems: Terminal[] = []): () => void {
  if (typeof window === 'undefined') return () => {};
  stopTerminalSync();

  if (initialItems.length > 0) {
    applyPatch({ terminales: mergeById((cache as any).terminales, initialItems) });
  }

  // Cuando Turso está activo, la hidratación inicial sale de Turso y servidor Turso
  // deja de ser fuente de lectura para terminales/ventas durante la migración.
  // El cache local conserva la última vista mientras llega la respuesta.
  void (async () => {
    try {
      const terminals = await tryTursoRead('terminales', all ? {} : { limit: 1, terminalId });
      if (terminals !== null) {
        applyPatch({ terminales: all ? terminals : mergeById((cache as any).terminales, terminals) });
        const sales = await tryTursoRead('ventas', all ? { limit: 500 } : { limit: 500, terminalId });
        if (sales !== null) applyPatch({ ventas: sales });
        return;
      }

      if (!db) return;

  const target = all
    ? collection(db, COLLECTIONS.terminales)
    : (terminalId ? doc(db, COLLECTIONS.terminales, terminalId) : null);

  if (!target) return () => {};

  const unsub = onSnapshot(
    target as any,
    (snap: any) => {
      if (all) {
        const items = snap.docs.map((d: any) => sanitizeForFirestore(d.data())).filter(Boolean);
        applyPatch({ terminales: items });
      } else if (snap.exists()) {
        const item = sanitizeForFirestore(snap.data());
        const id = String(item?.id || snap.id);
        applyPatch({ terminales: mergeById((cache as any).terminales, [{ ...item, id }]) });
      }
    },
    (err: any) => {
      if (err?.code !== 'permission-denied') console.warn("Sync terminal:", err);
    }
  );
  terminalSyncFns.main = unsub;

  // Historial operativo del POS: para un cajero cargamos las ventas de SU caja,
  // no solo las últimas 50 ventas globales. Así un reinicio no puede dejar la
  // pantalla mostrando únicamente operaciones antiguas de otra jornada/caja.
  // Se usa solo un filtro de igualdad para evitar depender de un índice compuesto;
  // el orden se hace en memoria.
  const salesQuery = all
    ? query(collection(db, COLLECTIONS.ventas), limit(500))
    : (terminalId
      ? query(collection(db, COLLECTIONS.ventas), where('terminalId', '==', terminalId), limit(500))
      : null);

  if (salesQuery) {
    const salesUnsub = onSnapshot(
      salesQuery,
      (snap: any) => {
        const items = snap.docs
          .map((d: any) => sanitizeForFirestore({ ...d.data(), id: d.data()?.id || d.id }))
          .filter(Boolean)
          .sort((a: any, b: any) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
        applyPatch({ ventas: items });
      },
      (err: any) => {
        if (err?.code !== 'permission-denied') console.warn("Sync ventas terminal:", err);
      }
    );
    terminalSyncFns.sales = salesUnsub;
  }

  return stopTerminalSync;
    } catch (e) {
      console.error('[db-store] Error hidratando terminal/ventas desde Turso:', e);
    }
  })();

  return stopTerminalSync;
}



function stopMasterSync(name: string): void {
  const unsub = masterSyncFns[name];
  if (unsub) {
    try { unsub(); } catch (e) { console.error(e); }
    delete masterSyncFns[name];
  }
  // Al cerrar el listener ya no podemos considerar esta colección como
  // completamente hidratada por realtime. Si un módulo pide el histórico
  // después, ensureLoaded() volverá a consultarlo solo cuando sea necesario.
  if (name === 'clientes' || name === 'proveedores') {
    loadedAll[name] = false;
  }
}

function startMasterSync(name: string): () => void {
  if (typeof window === 'undefined') return () => {};
  if (!COLLECTIONS[name]) return () => {};
  if (masterSyncFns[name]) return () => stopMasterSync(name);

  // Con Turso activo, clientes/proveedores deben salir de Turso. El listener
  // servidor Turso se conserva únicamente como fallback cuando Turso no está configurado.
  void (async () => {
    try {
      const tursoItems = await tryTursoRead(name, { limit: 2000 });
      if (tursoItems !== null) {
        applyPatch({ [name]: tursoItems });
        loadedAll[name] = true;
        return;
      }
    } catch (e) {
      console.error('[db-store] Error cargando ' + name + ' desde Turso:', e);
      return;
    }

    if (!db) return;
    const col = COLLECTIONS[name];
    const unsub = onSnapshot(
      collection(db, col),
      (snap) => {
        const items = snap.docs
          .map(d => sanitizeForFirestore(d.data()))
          .filter(Boolean);
        applyPatch({ [name]: items });
        if (name === 'clientes' || name === 'proveedores') loadedAll[name] = true;
      },
      (err) => {
        if (err.code !== 'permission-denied') console.warn("Sync maestro " + name + ":", err);
      }
    );
    masterSyncFns[name] = unsub;
  })();

  return () => stopMasterSync(name);
}

// Ajusta los listeners maestros al módulo activo sin reiniciarlos cuando
// el nuevo módulo sigue necesitando la misma colección. Así, por ejemplo,
// Dashboard → Ventas → CxC mantiene un único listener de clientes durante
// toda la navegación y evita repetir el snapshot inicial completo.
function syncMasterSync(names: string[]): void {
  const wanted = new Set(names.filter(name => !!COLLECTIONS[name]));
  Object.keys(masterSyncFns).forEach(name => {
    if (!wanted.has(name)) stopMasterSync(name);
  });
  wanted.forEach(name => {
    if (!masterSyncFns[name]) startMasterSync(name);
  });
}

function cleanup() {
  teardownFns.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  teardownFns = [];
  Object.keys(masterSyncFns).forEach(stopMasterSync);
  stopTerminalSync();
  started = false;
  Object.keys(loadedAll).forEach(k => { loadedAll[k] = false; });
  Object.keys(cursors).forEach(k => { cursors[k] = null; });
}

function init() {
  if (started) return;
  started = true;
  if (typeof window === 'undefined') return;

  // 1) CONFIG: Turso es la única fuente de verdad operacional.
  // No condicionamos esta carga a servidor Turso: la tasa BCV y el resto de la
  // configuración deben hidratarse directamente desde app_config/general
  // aunque el cliente servidor Turso no exista o no esté inicializado.
  void (async () => {
    try {
      const tursoConfig = await tryTursoSpecialRead('config');
      const patch: any = {};
      for (const f of CONFIG_FIELDS) if (tursoConfig?.[f] !== undefined) {
        patch[f] = sanitizeForFirestore(tursoConfig[f]);
      }
      if (Object.keys(patch).length) applyPatch(patch);
      await loadCatalogs(true, String(tursoConfig?.catalogosVersion || ''));
    } catch (error) {
      console.error('[db-store] Error cargando configuración desde Turso:', error);
    }
  })();

  // 2) PRODUCTOS: Turso es la fuente cuando está activo. RTDB solo se usa como fallback.
  void (async () => {
    const usingTurso = await bootstrapProductos();
    if (usingTurso || !rtdb) return;
    teardownFns.push(onValue(ref(rtdb, RTDB_PRODUCTS_PATH), (snap) => {
      const val = snap.val() || {};
      const items = Object.values(val).filter(Boolean);
      applyPatch({ productos: items });
    }, (err) => { if (err?.code !== 'permission-denied') console.warn("RTDB productos:", err); }));
  })();

  // 3) LISTAS VIVAS ENTRE CAJAS.
  // CxC/CxP: el POS solo necesita deuda ACTIVA en tiempo real. Mantener
  // miles de deudas ya pagadas conectadas en cada terminal genera lecturas
  // iniciales innecesarias. El histórico completo se hidrata únicamente
  // cuando se entra al módulo que lo necesita.
  // CxC/CxP: Turso es la fuente de lectura cuando está activo. servidor Turso
  // conserva el listener únicamente como fallback mientras Turso no esté configurado.
  void (async () => {
    for (const name of ['cxc', 'cxp']) {
      try {
        const tursoItems = await tryTursoRead(name, { limit: 2000 });
        if (tursoItems !== null) {
          applyPatch({ [name]: tursoItems.filter((x: any) => ['pendiente', 'parcial'].includes(String(x?.estado || ''))) });
          continue;
        }
        const col = COLLECTIONS[name];
        teardownFns.push(onSnapshot(
          query(collection(db, col), where('estado', 'in', ['pendiente', 'parcial'])),
          (snap) => {
            const currentArr = [...((cache as any)[name] || [])];
            const map = new Map<string, any>(currentArr.map(x => [String(x.id), x]));
            snap.docChanges().forEach(change => {
              const item = sanitizeForFirestore(change.doc.data());
              const id = String(item?.id || change.doc.id);
              if (change.type === 'removed') {
                if (item && String(item.estado || '') !== 'pagada') map.delete(id);
              } else if (item) map.set(id, item);
            });
            applyPatch({ [name]: [...map.values()] });
          },
          (err) => { if (err.code !== 'permission-denied') console.warn("Sync " + name + ":", err); }
        ));
      } catch (e) {
        console.error("[db-store] Error leyendo " + name + " desde Turso:", e);
      }
    }
  })();

  // Clientes/proveedores se sincronizan solo mientras el módulo que los necesita está abierto.
  // Así evitamos descargar y mantener dos colecciones maestras completas en cada caja
  // durante toda la jornada cuando el operador está trabajando en otro módulo.

  // Terminales: el listener se activa bajo demanda.
  // Un cajero escucha solo SU terminal; administradores pueden activar el
  // listado completo cuando necesitan gestionar las cajas.
  // Históricos de auditoría: solo mantenemos una ventana reciente en realtime.
  // El histórico completo se carga bajo demanda al abrir el módulo correspondiente.
  void (async () => {
    for (const name of ['devoluciones', 'anulaciones', 'reportesZ']) {
      try {
        const tursoItems = await tryTursoRead(name, { limit: 100 });
        if (tursoItems !== null) {
          applyPatch({ [name]: tursoItems });
          continue;
        }
        const col = COLLECTIONS[name];
        teardownFns.push(onSnapshot(
          query(collection(db, col), orderBy('fecha', 'desc'), limit(100)),
          (snap) => {
            const currentArr = [...((cache as any)[name] || [])];
            const map = new Map<string, any>(currentArr.map(x => [String(x.id), x]));
            snap.docChanges().forEach(change => {
              const item = sanitizeForFirestore(change.doc.data());
              if (!item || !item.id) return;
              if (change.type === 'removed') map.delete(String(item.id));
              else map.set(String(item.id), item);
            });
            applyPatch({ [name]: [...map.values()] });
          },
          (err) => { if (err.code !== 'permission-denied') console.warn("Sync " + name + ":", err); }
        ));
      } catch (e) {
        console.error("[db-store] Error leyendo " + name + " desde Turso:", e);
      }
    }
  })();

  // Históricos operativos: Turso es la única fuente de movimientos.
  // No se instala ningún listener servidor Turso/Firestore porque servidor Turso fue retirado.
  void (async () => {
    try {
      const tursoItems = await tryTursoRead('movimientos', { limit: 50 });
      if (tursoItems !== null) applyPatch({ movimientos: tursoItems });
    } catch (e) {
      console.error('[db-store] Error leyendo movimientos desde Turso:', e);
    }
  })();

  // 4) CARGA INICIAL: listas pequeñas completas + ventas/libroDiario COMPLETOS
  //    (cada caja filtra por su propio corte Z, así que ninguna puede perder datos
  //    porque otra caja cierre el suyo). El resto del histórico se carga bajo
  //    demanda cuando se abre el módulo que lo necesita.
  // Los listeners ya entregan el snapshot inicial de estas colecciones.
  // No hacemos un getDocs() inmediatamente después: sería una segunda lectura
  // de los mismos documentos al arrancar. Los históricos se cargan bajo demanda
  // cuando el módulo correspondiente los necesita.


  // 4.5) LIBRO DIARIO: movimientos de caja y asientos deben hidratarse desde Turso
  void (async () => {
    try {
      const tursoItems = await tryTursoRead('libroDiario', { limit: 2000 });
      if (tursoItems !== null) applyPatch({ libroDiario: tursoItems });
    } catch (e) {
      console.error('[db-store] Error cargando libro diario desde Turso:', e);
    }
  })();

  // 5) CATÁLOGOS
  // Se hidratan desde la caché local. Si config/general detecta una versión
  // nueva, el listener anterior ejecuta loadCatalogs() de forma controlada.
}

async function ensurePurchaseHistory(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    // Historial de compras: cargar directamente desde Turso un bloque amplio.
    // Las compras migradas pueden ser anteriores a las primeras 500 operaciones
    // del cache inicial y no deben desaparecer del módulo por ese límite.
    const [compras, movimientos, cxp] = await Promise.all([
      tryTursoRead('compras', { limit: 2000 }),
      tryTursoRead('movimientos', { limit: 2000 }),
      tryTursoRead('cxp', { limit: 2000 }),
    ]);
    if (compras !== null) applyPatch({ compras: mergeById((cache as any).compras, compras) });
    if (movimientos !== null) applyPatch({ movimientos: mergeById((cache as any).movimientos, movimientos) });
    if (cxp !== null) applyPatch({ cxp: mergeById((cache as any).cxp, cxp) });
  } catch (e) {
    console.error('[db-store] Error cargando historial de compras desde Turso:', e);
    throw e;
  }
}

// ============================================================
// API PÚBLICA
// ============================================================
async function getSaleById(saleId: string): Promise<any | null> {
  if (!saleId) return null;
  const id = String(saleId);
  try {
    // Para consultas históricas, la venta debe salir de Turso directamente.
    // El cache local puede contener una versión antigua de la venta migrada
    // sin items y no debe ocultar el payload completo persistido.
    if (typeof window !== 'undefined') {
      const response = await fetch('/api/turso/store?table=ventas&id=' + encodeURIComponent(id), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (response.status === 503) throw new Error('Turso no está configurado o no está disponible.');
      const body: any = await response.json();
      if (!response.ok || body?.ok === false) throw new Error(String(body?.error || 'Turso rechazó la lectura.'));
      if (body?.record) return sanitizeForFirestore(body.record);
      return null;
    }
    const cached = (cache.ventas || []).find((v: any) => String(v?.id || '') === id);
    if (cached) return sanitizeForFirestore(cached);
    return null;
  } catch (e) {
    console.error('Error leyendo venta puntual:', e);
    throw e;
  }
}

export const Store = {
  ensurePurchaseHistory,
  applyInventoryMovementsTransaction,
  async createCashMovementTransaction(params: {
    operationId: string;
    movement: any;
    terminalId?: string;
  }): Promise<any> {
    if (typeof window === 'undefined') throw new Error('La operación de caja debe ejecutarse desde el POS.');
    const result = await tryTursoOperation('cashMovement', params);
    if (!result?.movement) throw new Error('Turso no confirmó el movimiento de caja.');
    return result;
  },
  subscribe(callback: (state: Partial<AppState>) => void): () => void {
    listeners.add(callback);
    init();
    callback(Store.get());
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) cleanup();
    };
  },

  get(): AppState {
    if (typeof window === 'undefined') return initialState;
    return { ...cache } as AppState;
  },

  /**
   * Aplica un abono sobre la deuda REAL de Firestore.
   * La deuda y sus efectos contables se escriben en una sola transacción,
   * evitando que dos cajas trabajen sobre el mismo saldo antiguo.
   */
  async processReturnOrCancellationTransaction(params: { operationId: string; operationType: 'DEVOLUCION' | 'ANULACION'; saleId: string; operationDoc: any; movements: any[]; journal?: any; refundItems?: any[]; fullCancellation?: boolean; fromOfflineQueue?: boolean; }): Promise<any> {
    const { operationId, operationType, saleId, operationDoc, movements, journal, refundItems = [], fullCancellation = false } = params;
    if (!params.fromOfflineQueue && typeof window !== 'undefined' && navigator.onLine === false) {
      enqueueOfflineOperation(operationType, { ...params }, operationId);
      return { queuedOffline: true, operationId };
    }
    const tursoResult = await tryTursoOperation('returnOrCancellation', params);
    if (tursoResult) return tursoResult;

    let result: any = null;
    await runTransaction(db, async tx => {
      const operationRef = await claimOperation(tx, operationType, operationId);
      const saleRef = doc(db, 'ventas', String(saleId));
      const saleSnap = await tx.get(saleRef);
      if (!saleSnap.exists()) throw new Error('La venta ya no existe en Firestore.');
      const sale = { ...sanitizeForFirestore(saleSnap.data()), id: String(saleId) } as any;
      if (operationType === 'ANULACION' && String(sale.estado || '') === 'anulada') throw new Error('La factura ya fue anulada.');
      const productIds = [...new Set((movements || []).map((m:any) => String(m.productoId || '')).filter(Boolean))];
      const products = new Map<string, any>();
      for (const pid of productIds) { const s = await tx.get(doc(db,'productos',pid)); if (!s.exists()) throw new Error('Un producto de la operación ya no existe en Firestore.'); products.set(pid,{...sanitizeForFirestore(s.data()),id:pid}); }
      const journalRef = journal ? doc(db,'libroDiario',String(journal.id)) : null;
      if (journalRef) { const js = await tx.get(journalRef); if (js.exists()) throw new Error('El asiento contable de esta operación ya existe.'); }
      const terminalId = String(operationDoc.terminalId || '');
      const terminalRef = terminalId ? doc(db,'terminales',terminalId) : null;
      const terminalSnap = terminalRef ? await tx.get(terminalRef) : null;
      if (terminalId && !terminalSnap?.exists()) throw new Error('La terminal de la operación ya no existe.');
      const terminalRemote = terminalSnap?.exists() ? sanitizeForFirestore(terminalSnap.data()) as any : null;
      const counterField = operationType === 'DEVOLUCION' ? 'proximaDevolucion' : 'proximaAnulacion';
      const label = operationType === 'DEVOLUCION' ? 'DEV' : 'ANU';
      const nextCounter = Number(terminalRemote?.[counterField]) || 1;
      const canonicalId = terminalRemote
        ? terminalSeries(terminalPrefix(terminalRemote, terminalId), label, nextCounter, 6)
        : terminalSeries('GLOBAL', label, Date.now(), 6);
      const canonicalOperationDoc = sanitizeForFirestore({ ...operationDoc, id: canonicalId, terminalId: terminalId || operationDoc.terminalId, terminalName: terminalRemote?.nombre || operationDoc.terminalName });
      const existingRef = doc(db, operationType === 'DEVOLUCION' ? 'devoluciones' : 'anulaciones', canonicalId);
      const existingOp = await tx.get(existingRef); if (existingOp.exists()) throw new Error('Esta operación ya fue registrada.');
      if ((movements?.length || 0) + productIds.length + 6 > 450) throw new Error('La operación contiene demasiados movimientos.');
      for (const m of movements || []) {
        const pid = String(m.productoId); const p = products.get(pid); const before = Number(p.stock)||0; const after = before + (Number(m.cantidad)||0);
        const mr = doc(db,'movimientos',String(m.id || Store.uid()));
        tx.set(mr,sanitizeForFirestore({...m,productoId:pid,stockAntes:before,stockDespues:after,id:mr.id}),{merge:false});
        products.set(pid,{...p,stock:after});
      }
      for (const [pid,p] of products) tx.set(doc(db,'productos',pid),sanitizeForFirestore(p),{merge:true});
      tx.set(existingRef, canonicalOperationDoc, {merge:false});
      tx.set(saleRef,sanitizeForFirestore({...sale,estado: operationType === 'ANULACION' ? 'anulada' : 'parcialmente_devuelta'}),{merge:true});
      if (journalRef && journal) tx.set(journalRef,sanitizeForFirestore({ ...journal, referencia: canonicalId, terminalId: terminalId || journal.terminalId, terminalName: terminalRemote?.nombre || journal.terminalName }),{merge:false});
      if (terminalRef && terminalRemote) tx.set(terminalRef, {[counterField]: nextCounter + 1}, {merge:true});
      tx.set(operationRef,{tipo:operationType,operationId,fecha:String(canonicalOperationDoc.fecha||Utils.ahora()),referencia:String(canonicalId),terminalId:terminalId||'GLOBAL'},{merge:false});
      result={operationId,operationType,receiptId:canonicalId,operationDoc:canonicalOperationDoc,products:[...products.values()],terminal: terminalRef ? {...terminalRemote,id:terminalId,[counterField]:nextCounter+1} : null};
    });
    if (result?.products?.length) await syncProductosRTDB([],result.products);
    return result;
  },

  async applyGlobalProviderPaymentTransaction(params: {
    operationId?: string;
    provider: string;
    amountUSD: number;
    amountBS?: number;
    payment: any;
    journal?: any;
    terminalId?: string;
  }): Promise<{ appliedUSD: number; debts: any[]; receiptId?: string }> {
    if (typeof window === 'undefined') return { appliedUSD: 0, debts: [] };
    const { operationId, provider, amountUSD, payment, journal, terminalId } = params;
    if (!(amountUSD > 0)) return { appliedUSD: 0, debts: [] };
    const tursoResult = await tryTursoOperation('globalProviderPayment', params);
    if (tursoResult) {
      const refreshedCxp = await tryTursoRead('cxp', { limit: 2000 });
      if (refreshedCxp !== null) applyPatch({ cxp: refreshedCxp });
      if (Array.isArray(tursoResult.journal)) applyPatch({ libroDiario: mergeById(cache.libroDiario, tursoResult.journal) });
      return tursoResult;
    }

    const effectiveTerminalId = String(terminalId || '').trim();
    const q = query(collection(db, 'cxp'), where('proveedor', '==', provider));
    let result = { appliedUSD: 0, debts: [] as any[] };
    const opId = String(operationId || payment?.id || (provider + '|' + amountUSD + '|' + payment?.fecha + '|' + payment?.metodo));
    await runTransaction(db, async tx => {
      const operationRef = await claimOperation(tx, 'PAGO-CXP-GLOBAL', opId);
      const terminalRef = effectiveTerminalId ? doc(db, 'terminales', effectiveTerminalId) : null;
      const terminalSnap = terminalRef ? await tx.get(terminalRef) : null;
      const terminalRemote = terminalSnap?.exists() ? sanitizeForFirestore(terminalSnap.data()) as any : null;
      if (terminalId && !terminalRemote) throw new Error('La caja/terminal ya no existe en Firestore.');
      // IMPORTANTE: Firestore puede reintentar esta función completa si detecta
      // concurrencia. Todo el resultado se reconstruye en cada intento para no
      // duplicar appliedUSD/debts en memoria.
      const nextResult = { appliedUSD: 0, debts: [] as any[], receiptId: '' as string };
      const nextCounter = Number(terminalRemote?.proximoPagoProveedor) || 1;
      nextResult.receiptId = terminalRemote
        ? terminalSeries(terminalPrefix(terminalRemote, terminalId), 'CXP', nextCounter, 6)
        : terminalSeries('GLOBAL', 'CXP', Date.now(), 6);
      const snap = await tx.get(q);

      const docs = snap.docs
        .map(d => ({ ref: d.ref, data: sanitizeForFirestore(d.data()) as any }))
        .filter(x => (Number(x.data.saldoUSD) || 0) > 0.001 && x.data.estado !== 'pagada')
        .sort((a, b) => {
          const fecha = String(a.data.fecha || '').localeCompare(String(b.data.fecha || ''));
          return fecha !== 0 ? fecha : String(a.data.id || '').localeCompare(String(b.data.id || ''));
        });

      let remanente = amountUSD;

      for (const item of docs) {
        if (remanente <= 0.001) break;

        const saldo = Number(item.data.saldoUSD) || 0;
        const pago = Math.min(saldo, remanente);
        if (pago <= 0.001) continue;

        remanente = Math.max(0, remanente - pago);

        const historial = Array.isArray(item.data.historialPagos) ? [...item.data.historialPagos] : [];
        const pagoHistorial = sanitizeForFirestore({
          ...payment,
          id: nextResult.receiptId,
          reciboId: nextResult.receiptId,
          terminalId: terminalId || payment?.terminalId,
          // El mismo pago global puede liquidar varias facturas, pero cada
          // entrada conserva exactamente lo aplicado a esa factura.
          montoUSD: pago,
          montoBS: pago * (Number(payment.tasaAplicada) || 1)
        });
        historial.push(pagoHistorial);

        const nuevoSaldo = Math.max(0, saldo - pago);
        const updated = {
          ...item.data,
          abonadoUSD: (Number(item.data.abonadoUSD) || 0) + pago,
          saldoUSD: nuevoSaldo,
          estado: nuevoSaldo <= 0.001 ? 'pagada' : 'parcial',
          historialPagos: historial
        };

        tx.set(item.ref, sanitizeForFirestore(updated), { merge: true });
        nextResult.debts.push({ ...updated, appliedUSD: pago });
        nextResult.appliedUSD += pago;
      }

      if (nextResult.appliedUSD <= 0.001) {
        throw new Error('No hay saldo pendiente del proveedor para registrar este pago.');
      }

      if (journal?.id) {
        tx.set(
          doc(db, 'libroDiario', journal.id),
          sanitizeForFirestore({ ...journal, montoUSD: nextResult.appliedUSD, referencia: nextResult.receiptId, terminalId: terminalId || journal.terminalId, terminalName: terminalRemote?.nombre || journal.terminalName }),
          { merge: true }
        );
      }
      if (terminalRef && terminalRemote) tx.set(terminalRef, { proximoPagoProveedor: nextCounter + 1 }, { merge: true });

      tx.set(operationRef, { tipo: 'PAGO-CXP-GLOBAL', operationId: opId, fecha: payment?.fecha || new Date().toISOString(), referencia: nextResult.receiptId, terminalId: effectiveTerminalId }, { merge: false });
      result = nextResult;
    });

    // CxP se actualiza exclusivamente por el snapshot completo autoritativo.
    if (journal?.id) applyPatch({ libroDiario: mergeById(cache.libroDiario, [{ ...journal, montoUSD: result.appliedUSD, referencia: result.receiptId, terminalId: terminalId || journal.terminalId }]) });

    return result;
  },

  async applyGlobalCustomerPaymentTransaction(params: {
    operationId?: string;
    customerName: string;
    customerCedula?: string;
    amountUSD: number;
    amountBS?: number;
    payment: any;
    journal?: any;
    terminalId?: string;
  }): Promise<{ appliedUSD: number; appliedBS: number; debts: any[]; receiptId?: string }> {
    if (typeof window === 'undefined') return { appliedUSD: 0, appliedBS: 0, debts: [] };
    const { operationId, customerName, customerCedula, amountUSD, amountBS, payment, journal, terminalId } = params;
    if (!(amountUSD > 0)) return { appliedUSD: 0, appliedBS: 0, debts: [] };
    const tursoResult = await tryTursoOperation('globalCustomerPayment', params);
    if (tursoResult) {
      if (Array.isArray(tursoResult.debts)) applyPatch({ cxc: mergeById(cache.cxc, tursoResult.debts) });
      // Un pago global puede liquidar varias facturas. Volver a leer CxC desde
      // Turso garantiza que todas las facturas afectadas y sus historiales
      // queden visibles inmediatamente en la interfaz.
      const refreshedCxc = await tryTursoRead('cxc', { limit: 2000 });
      if (refreshedCxc !== null) applyPatch({ cxc: refreshedCxc });
      if (tursoResult.sale?.id) applyPatch({ ventas: mergeById(cache.ventas, [tursoResult.sale]) });
      if (journal?.id) applyPatch({ libroDiario: mergeById(cache.libroDiario, [{ ...journal, montoUSD: tursoResult.appliedUSD, montoBS: tursoResult.appliedBS, referencia: tursoResult.receiptId, terminalId: terminalId || journal.terminalId }]) });
      if (tursoResult.terminal?.id) applyPatch({ terminales: mergeById(cache.terminales || [], [tursoResult.terminal]) });
      return tursoResult;
    }

    const customerLabel = customerCedula ? `${customerName} [${customerCedula}]` : customerName;
    const q = query(collection(db, 'cxc'), where('cliente', '==', customerLabel));
    let result = { appliedUSD: 0, appliedBS: 0, debts: [] as any[], receiptId: '' as string };
    const opId = String(operationId || payment?.id || ('CXC-GLOBAL|' + customerLabel + '|' + amountUSD + '|' + payment?.fecha + '|' + payment?.metodo));

    await runTransaction(db, async tx => {
      const operationRef = await claimOperation(tx, 'PAGO-CXC-GLOBAL', opId);
      const terminalRef = terminalId ? doc(db, 'terminales', terminalId) : null;
      const terminalSnap = terminalRef ? await tx.get(terminalRef) : null;
      const terminalRemote = terminalSnap?.exists() ? sanitizeForFirestore(terminalSnap.data()) as any : null;
      if (terminalId && !terminalRemote) throw new Error('La caja/terminal ya no existe en Firestore.');

      const nextResult = { appliedUSD: 0, appliedBS: 0, debts: [] as any[], receiptId: '' as string };
      const nextCounter = Number(terminalRemote?.proximoCobroDeuda) || 1;
      nextResult.receiptId = terminalRemote
        ? terminalSeries(terminalPrefix(terminalRemote, terminalId), 'CXC', nextCounter, 6)
        : terminalSeries('GLOBAL', 'CXC', Date.now(), 6);

      const snap = await tx.get(q);
      const docs = snap.docs
        .map(d => ({ ref: d.ref, data: sanitizeForFirestore(d.data()) as any }))
        .filter(x => (Number(x.data.saldoUSD) || 0) > 0.001 && x.data.estado !== 'pagada')
        .sort((a, b) => {
          const fecha = String(a.data.fecha || '').localeCompare(String(b.data.fecha || ''));
          return fecha !== 0 ? fecha : String(a.data.id || '').localeCompare(String(b.data.id || ''));
        });

      let remanenteUSD = amountUSD;
      let remanenteBS = Number(amountBS) > 0 ? Number(amountBS) : amountUSD * (Number(payment?.tasaAplicada) || Number(Store.get().tasa) || 0);
      const tasaAplicada = Number(payment?.tasaAplicada) || Number(Store.get().tasa) || 0;

      for (const item of docs) {
        if (remanenteUSD <= 0.000001) break;
        const saldo = Number(item.data.saldoUSD) || 0;
        const pagoUSD = Math.min(saldo, remanenteUSD);
        if (pagoUSD <= 0) continue;

        const pagoBS = Math.min(remanenteBS, pagoUSD * tasaAplicada);
        remanenteUSD = Math.max(0, remanenteUSD - pagoUSD);
        remanenteBS = Math.max(0, remanenteBS - pagoBS);

        const historial = Array.isArray(item.data.historialPagos) ? [...item.data.historialPagos] : [];
        const pagoHistorial = sanitizeForFirestore({
          ...payment,
          id: nextResult.receiptId,
          reciboId: nextResult.receiptId,
          terminalId: terminalId || payment?.terminalId,
          montoUSD: pagoUSD,
          montoBS: pagoBS
        });
        historial.push(pagoHistorial);

        const nuevoSaldo = Math.max(0, saldo - pagoUSD);
        const updated = {
          ...item.data,
          abonadoUSD: (Number(item.data.abonadoUSD) || 0) + pagoUSD,
          saldoUSD: nuevoSaldo,
          estado: nuevoSaldo <= 0.001 ? 'pagada' : 'parcial',
          historialPagos: historial
        };

        tx.set(item.ref, sanitizeForFirestore(updated), { merge: true });
        nextResult.debts.push({ ...updated, appliedUSD: pagoUSD, appliedBS: pagoBS });
        nextResult.appliedUSD += pagoUSD;
        nextResult.appliedBS += pagoBS;
      }

      if (nextResult.appliedUSD <= 0.000001) {
        throw new Error('No hay saldo pendiente del cliente para registrar este pago.');
      }

      if (customerCedula) {
        const customersSnap = await tx.get(query(collection(db, 'clientes'), where('cedula', '==', customerCedula), limit(1)));
        if (!customersSnap.empty) {
          const customerRef = customersSnap.docs[0].ref;
          const customer = customersSnap.docs[0].data() as any;
          const customerDebt = Number(customer.debt) || 0;
          tx.set(customerRef, { debt: Math.max(0, customerDebt - nextResult.appliedUSD) }, { merge: true });
        }
      }

      if (journal?.id) {
        tx.set(
          doc(db, 'libroDiario', journal.id),
          sanitizeForFirestore({
            ...journal,
            montoUSD: nextResult.appliedUSD,
            montoBS: nextResult.appliedBS,
            referencia: nextResult.receiptId,
            terminalId: terminalId || journal.terminalId,
            terminalName: terminalRemote?.nombre || journal.terminalName
          }),
          { merge: true }
        );
      }

      if (terminalRef && terminalRemote) tx.set(terminalRef, { proximoCobroDeuda: nextCounter + 1 }, { merge: true });
      tx.set(operationRef, {
        tipo: 'PAGO-CXC-GLOBAL',
        operationId: opId,
        fecha: payment?.fecha || new Date().toISOString(),
        referencia: nextResult.receiptId,
        terminalId: effectiveTerminalId
      }, { merge: false });

      nextResult.debts = nextResult.debts.map((d: any) => d);
      result = nextResult;
    });

    if (journal?.id) {
      applyPatch({
        libroDiario: mergeById(cache.libroDiario, [{
          ...journal,
          montoUSD: result.appliedUSD,
          montoBS: result.appliedBS,
          referencia: result.receiptId,
          terminalId: terminalId || journal.terminalId
        }])
      });
    }

    return result;
  },

  async applyDebtPaymentTransaction(params: {
    operationId?: string;
    collection: 'cxc' | 'cxp';
    debtId: string;
    amountUSD: number;
    amountBS?: number;
    payment: any;
    journal?: any | any[];
    sale?: any;
    customerCedula?: string;
    terminalId?: string;
  }): Promise<any | null> {
    if (typeof window === 'undefined') return null;
    const { operationId, collection: collectionName, debtId, amountUSD, amountBS, payment, journal, sale, customerCedula, terminalId } = params;
    if (!(amountUSD > 0)) return null;
    const tursoResult = await tryTursoOperation('debtPayment', params);
    if (tursoResult) {
      if (tursoResult.id) {
        applyPatch({ [collectionName]: mergeById((cache as any)[collectionName] || [], [tursoResult]) });
      }

      // El pago individual CxP es una operación administrativa y su asiento
      // debe aparecer inmediatamente en Contabilidad, sin depender de una
      // recarga ni de que el listado de CxP haya sido hidratado nuevamente.
      if (collectionName === 'cxp' && tursoResult.id) {
        applyPatch({ cxp: mergeById(cache.cxp || [], [tursoResult]) });
      }

      // Tras un cobro CxC, hidratar CxC completa desde Turso para que el
      // historial de cada pago/abono aparezca inmediatamente, incluso cuando
      // la deuda pasó de activa a pagada y dejó de pertenecer al listado activo.
      if (collectionName === 'cxc') {
        const refreshedCxc = await tryTursoRead('cxc', { limit: 2000 });
        if (refreshedCxc !== null) applyPatch({ cxc: refreshedCxc });
      }

      if (tursoResult.sale?.id) {
        applyPatch({ ventas: mergeById(cache.ventas, [tursoResult.sale]) });
      }

      if (Array.isArray(tursoResult.journal) && tursoResult.journal.length) {
        applyPatch({ libroDiario: mergeById(cache.libroDiario || [], tursoResult.journal) });
      }

      if (tursoResult.terminal) {
        applyPatch({ terminales: mergeById(cache.terminales, [tursoResult.terminal]) });
      }

      return tursoResult;
    }
    const debtRef = doc(db, collectionName, debtId);
    let result: any = null;
    const opId = String(operationId || payment?.id || (collectionName + '|' + debtId + '|' + amountUSD + '|' + payment?.metodo + '|' + payment?.fecha));
    await runTransaction(db, async tx => {
      const operationRef = await claimOperation(tx, 'PAGO-DEUDA', opId);
      const terminalRef = terminalId ? doc(db, 'terminales', terminalId) : null;
      const terminalSnap = terminalRef ? await tx.get(terminalRef) : null;
      const terminalRemote = terminalSnap?.exists() ? sanitizeForFirestore(terminalSnap.data()) as any : null;
      if (terminalId && !terminalRemote) throw new Error('La caja/terminal ya no existe en Firestore.');
      const debtSnap = await tx.get(debtRef);
      if (!debtSnap.exists()) throw new Error('La deuda ya no existe o fue eliminada en otra caja.');
      const remote = sanitizeForFirestore(debtSnap.data()) as any;
      const saldoActual = Number(remote.saldoUSD) || 0;
      if (saldoActual <= 0.001) throw new Error('La deuda ya está pagada en otra caja.');
      if (amountUSD > saldoActual + 0.001) throw new Error('El saldo cambió en otra caja. Actualice y vuelva a intentar.');
      const applied = Math.min(amountUSD, saldoActual);
      const nuevoSaldo = Math.max(0, saldoActual - applied);
      const nuevoAbonado = (Number(remote.abonadoUSD) || 0) + applied;
      const historial = Array.isArray(remote.historialPagos) ? [...remote.historialPagos] : [];
      const counterField = collectionName === 'cxc' ? 'proximoCobroDeuda' : 'proximoPagoProveedor';
      const nextCounter = Number(terminalRemote?.[counterField]) || 1;
      const receiptId = terminalRemote ? terminalSeries(terminalPrefix(terminalRemote, terminalId), collectionName === 'cxc' ? 'CXC' : 'CXP', nextCounter, 6) : terminalSeries('GLOBAL', collectionName === 'cxc' ? 'CXC' : 'CXP', Date.now(), 6);
      const appliedBS = Number(amountBS) > 0 ? Math.min(Number(amountBS), Number(payment?.montoBS) || Number(amountBS)) : (Number(payment?.montoBS) || (applied * (Number(Store.get().tasa) || 0)));
      const pago = sanitizeForFirestore({ ...payment, id: receiptId, reciboId: receiptId, terminalId: terminalId || payment?.terminalId, montoUSD: applied, montoBS: appliedBS });
      historial.push(pago);
      const updated = {
        ...remote,
        ...(collectionName === 'cxc' && customerCedula ? {} : {}),
        abonadoUSD: nuevoAbonado,
        saldoUSD: nuevoSaldo,
        estado: nuevoSaldo <= 0.001 ? 'pagada' : 'parcial',
        historialPagos: historial
      };
      let customerRef: any = null;
      let customerDebt: number | null = null;
      if (collectionName === 'cxc' && customerCedula) {
        const customersSnap = await tx.get(query(collection(db, 'clientes'), where('cedula', '==', customerCedula), limit(1)));
        if (!customersSnap.empty) {
          customerRef = customersSnap.docs[0].ref;
          const customer = customersSnap.docs[0].data() as any;
          customerDebt = Number(customer.debt) || 0;
        }
      }
      tx.set(debtRef, sanitizeForFirestore(updated), { merge: true });
      if (customerRef) tx.set(customerRef, { debt: Math.max(0, (customerDebt || 0) - applied) }, { merge: true });
      const journalItems = (Array.isArray(journal) ? journal : (journal ? [journal] : [])).map((entry: any) => entry ? sanitizeForFirestore({ ...entry, referencia: receiptId, terminalId: terminalId || entry.terminalId, terminalName: terminalRemote?.nombre || entry.terminalName }) : entry);
      journalItems.forEach((entry: any) => {
        if (entry?.id) tx.set(doc(db, 'libroDiario', entry.id), sanitizeForFirestore(entry), { merge: true });
      });
      const persistedSale = sale?.id
        ? sanitizeForFirestore({ ...sale, id: receiptId, terminalId: terminalId || sale.terminalId, terminalName: terminalRemote?.nombre || sale.terminalName })
        : null;
      if (persistedSale?.id) tx.set(doc(db, 'ventas', persistedSale.id), persistedSale, { merge: true });
      if (terminalRef && terminalRemote) {
        tx.set(terminalRef, { [counterField]: nextCounter + 1 }, { merge: true });
      }
      tx.set(operationRef, { tipo: 'PAGO-DEUDA', operationId: opId, fecha: payment?.fecha || new Date().toISOString(), referencia: debtId }, { merge: false });
      result = { ...updated, appliedUSD: applied, appliedBS, receiptId, payment: pago, journal: journalItems, sale: persistedSale, terminal: terminalRef ? { ...terminalRemote, id: terminalId, [counterField]: nextCounter + 1 } : null };
    });
    // CxC/CxP se actualizan exclusivamente por sus snapshots completos autoritativos.
    // No parcheamos aquí el resultado local: un snapshot remoto puede haber llegado
    // inmediatamente antes y el resultado de esta transacción sería una versión
    // potencialmente antigua para la UI de esta caja.
    if (result?.journal?.length) applyPatch({ libroDiario: mergeById(cache.libroDiario, result.journal) });
    if (result?.sale?.id) applyPatch({ ventas: mergeById(cache.ventas, [result.sale]) });
    if (result?.terminal?.id) applyPatch({ terminales: mergeById(cache.terminales || [], [result.terminal]) });
    return result;
  },

  async createSupplierDebtTransaction(params: {
    operationId?: string;
    debt: any;
    journal?: any;
  }): Promise<any> {
    // En modo Turso no existe `db` local: Turso es la única fuente operativa.
    // No debemos bloquear esta ruta antes de llamar al endpoint /api/turso/store.
    if (typeof window === 'undefined') return null;
    const tursoResult = await tryTursoOperation('supplierDebt', params);
    if (tursoResult) {
      // Turso confirma la deuda, pero la UI administrativa necesita reflejar
      // inmediatamente ese mismo registro en memoria para que CxP y
      // "Total a Pagar" se actualicen sin recargar la página.
      const debtFromTurso = tursoResult.debt || params.debt;
      const patch: Partial<AppState> = {};
      if (debtFromTurso?.id) {
        patch.cxp = mergeById(cache.cxp || [], [debtFromTurso]);
      }
      if (params.journal?.id) {
        patch.libroDiario = mergeById(cache.libroDiario || [], [params.journal]);
      }
      if (Object.keys(patch).length) applyPatch(patch);
      return debtFromTurso;
    }
    const { operationId, debt, journal } = params;
    const debtRef = doc(db, 'cxp', debt.id);
    let result: any = null;
    const opId = String(operationId || debt.id);
    await runTransaction(db, async tx => {
      const operationRef = await claimOperation(tx, 'DEUDA-CXP', opId);
      const existing = await tx.get(debtRef);
      if (existing.exists()) throw new Error('La deuda de proveedor ya existe en otra caja. Actualice y vuelva a intentar.');
      tx.set(debtRef, sanitizeForFirestore(debt), { merge: false });
      if (journal?.id) tx.set(doc(db, 'libroDiario', journal.id), sanitizeForFirestore(journal), { merge: false });
      tx.set(operationRef, { tipo: 'DEUDA-CXP', operationId: opId, fecha: debt.fecha, referencia: debt.id }, { merge: false });
      result = debt;
    });
    // CxP se actualiza exclusivamente por el snapshot completo autoritativo.
    if (journal?.id) applyPatch({ libroDiario: mergeById(cache.libroDiario, [journal]) });
    return result;
  },

  async syncProductsStockFromKardex(): Promise<any> {
    if (typeof window === 'undefined') {
      throw new Error('La sincronización de inventario solo puede ejecutarse desde el cliente mediante Turso.');
    }
    const result = await tryTursoOperation('inventoryStockSync', {});
    if (!result) throw new Error('Turso no confirmó la sincronización del stock con Kardex.');
    // Reflejar inmediatamente en memoria todo lo que la misma transacción
    // de Turso acaba de confirmar. Esto evita que Contabilidad tenga que
    // recargar la página para mostrar el egreso/asiento del contado, y mantiene
    // sincronizados Compras, CxP, Kardex y Productos.
    const patch: Partial<AppState> = {};
    if (Array.isArray(result.products) && result.products.length) {
      patch.productos = mergeById(cache.productos, result.products);
    }
    if (result.purchase) {
      patch.compras = mergeById(cache.compras, [result.purchase]);
    }
    if (result.debt) {
      patch.cxp = mergeById(cache.cxp, [result.debt]);
    }
    if (result.journal) {
      patch.libroDiario = mergeById(cache.libroDiario, [result.journal]);
    }
    if (Array.isArray(result.movements) && result.movements.length) {
      patch.movimientos = mergeById(cache.movimientos, result.movements);
    }
    if (Object.keys(patch).length) {
      applyPatch(patch);
    }
    return result;
  },

  async createSaleTransaction(params: any): Promise<any> {
    // El POS opera exclusivamente contra Turso. Este puente faltaba en el
    // Store aunque la transacción y el endpoint de Turso sí existen.
    if (typeof window === 'undefined') {
      throw new Error('Las ventas solo pueden registrarse desde el cliente mediante Turso.');
    }

    const result = await tryTursoOperation('sale', params);
    if (!result?.sale) {
      throw new Error('Turso no confirmó el registro de la venta.');
    }

    // Reflejar inmediatamente la misma transacción confirmada por Turso.
    // Esto mantiene POS, Kardex, CxC, Contabilidad y Caja sincronizados sin
    // tocar los módulos administrativos ni introducir otra fuente de datos.
    const patch: Partial<AppState> = {};
    patch.ventas = mergeById(cache.ventas || [], [result.sale]);
    if (result.debt) {
      patch.cxc = mergeById(cache.cxc || [], [result.debt]);
    }
    if (Array.isArray(result.movements) && result.movements.length) {
      patch.movimientos = mergeById(cache.movimientos || [], result.movements);
    }
    if (Array.isArray(result.journal) && result.journal.length) {
      patch.libroDiario = mergeById(cache.libroDiario || [], result.journal);
    }
    if (result.terminal) {
      patch.terminales = mergeById(cache.terminales || [], [result.terminal]);
    }
    if (Array.isArray(result.products) && result.products.length) {
      patch.productos = mergeById(cache.productos || [], result.products);
    }
    applyPatch(patch);

    return result;
  },

  async createPurchaseTransaction(params: {
    operationId?: string;
    purchase: any;
    items: any[];
    purchaseDate: string;
    purchaseDateTime: string;
    supplier: string;
    invoiceNumber: string;
    condition: 'contado' | 'credito' | 'mixto';
    exchangeRate: number;
    paidUSD: number;
    dueDate: string;
    journal?: any;
    debt?: any;
  }): Promise<any> {
    // ÚNICA FUENTE DE VERDAD: Turso.
    // Esta operación ya no tiene ningún camino alternativo de persistencia.
    if (typeof window === 'undefined') {
      throw new Error('Las compras solo pueden registrarse desde el cliente mediante Turso.');
    }

    const { items, invoiceNumber, supplier, exchangeRate } = params;
    if (!items?.length) throw new Error('La compra no contiene productos.');
    if (!invoiceNumber || !supplier) throw new Error('La compra no tiene factura/proveedor.');
    if (!(Number(exchangeRate) > 0)) throw new Error('La tasa de la compra no es válida.');

    const result = await tryTursoOperation('createPurchase', params);
    if (!result) {
      throw new Error('Turso no confirmó el registro de la compra.');
    }

    // Reflejar inmediatamente en memoria la misma transacción confirmada por Turso.
    // En una compra mixta existe un pago contado (asiento) y un saldo CxP; ambos
    // deben aparecer en Contabilidad/CxP sin obligar al usuario a recargar la página.
    const patch: Partial<AppState> = {};
    if (result.purchase) {
      patch.compras = mergeById(cache.compras || [], [result.purchase]);
    }
    if (result.debt) {
      patch.cxp = mergeById(cache.cxp || [], [result.debt]);
    }
    if (result.journal) {
      patch.libroDiario = mergeById(cache.libroDiario || [], [result.journal]);
    }
    if (Array.isArray(result.movements) && result.movements.length) {
      patch.movimientos = mergeById(cache.movimientos || [], result.movements);
    }
    if (Array.isArray(result.products) && result.products.length) {
      patch.productos = mergeById(cache.productos || [], result.products);
    }
    if (Object.keys(patch).length) {
      applyPatch(patch);
    }
    return result;
  },

  async deletePurchaseTransaction(params: {
    operationId?: string;
    purchaseId?: string;
    invoiceNumber: string;
    supplier: string;
    purchaseDate?: string;
  }): Promise<any> {
    // Eliminación de compras: Turso es la única fuente de verdad.
    // No se consulta ni se utiliza ningún camino legacy.
    if (typeof window === 'undefined') {
      throw new Error('La eliminación de compras solo puede ejecutarse desde el cliente mediante Turso.');
    }

    const invoiceNumber = String(params.invoiceNumber || '').trim();
    const supplier = String(params.supplier || '').trim();
    if (!invoiceNumber || !supplier) {
      throw new Error('La compra no tiene factura/proveedor identificables.');
    }

    const result = await tryTursoOperation('deletePurchase', params);
    if (!result) throw new Error('Turso no confirmó la eliminación de la compra.');

    // Reflejar inmediatamente en la UI exactamente lo que confirmó Turso.
    const deletedPurchaseIds = new Set((result.deletedPurchaseIds || []).map((id: any) => String(id)));
    const deletedDebtIds = new Set((result.deletedDebtIds || []).map((id: any) => String(id)));
    const deletedJournalIds = new Set((result.deletedJournalIds || []).map((id: any) => String(id)));
    const deletedMovementIds = new Set((result.deletedMovementIds || []).map((id: any) => String(id)));

    const purchaseReference = `COMPRA FACT: ${invoiceNumber} - PROV: ${supplier}`;
    const purchaseDate = String(params.purchaseDate || '').slice(0, 10);

    const comprasRestantes = (cache.compras || []).filter((p: any) => {
      const sameId = deletedPurchaseIds.has(String(p?.id || ''));
      const samePurchase = String(p?.numeroFactura || '').trim() === invoiceNumber
        && String(p?.proveedor || '').trim() === supplier
        && (!purchaseDate || String(p?.fecha || '').slice(0, 10) === purchaseDate);
      return !sameId && !samePurchase;
    });

    const cxpRestante = (cache.cxp || []).filter((d: any) => {
      const sameId = deletedDebtIds.has(String(d?.id || ''));
      const sameDebt = String(d?.numeroFactura || '').trim() === invoiceNumber
        && String(d?.proveedor || '').trim() === supplier
        && (!purchaseDate || String(d?.fecha || '').slice(0, 10) === purchaseDate);
      return !sameId && !sameDebt;
    });

    const movimientosRestantes = (cache.movimientos || [])
      .filter((m: any) => !deletedMovementIds.has(String(m?.id || ''))
        && String(m?.referencia || '') !== purchaseReference)
      .map((m: any) => m);

    const libroRestante = (cache.libroDiario || [])
      .filter((j: any) => !deletedJournalIds.has(String(j?.id || ''))
        && !(String(j?.referencia || '') === invoiceNumber && String(j?.categoria || '') === 'COMPRA'));

    applyPatch({
      compras: comprasRestantes,
      cxp: cxpRestante,
      movimientos: mergeById(movimientosRestantes, Array.isArray(result.movements) ? result.movements : []),
      productos: mergeById(
        cache.productos,
        Array.isArray(result.products) ? result.products : []
      ),
      libroDiario: libroRestante
    });

    return result;
  },

  async deleteCustomerAndDebtsTransaction(params: {
    operationId?: string;
    customerId: string;
    customerName?: string;
    customerCedula?: string;
  }): Promise<any> {
    if (typeof window === 'undefined' || !db) return null;
    const tursoResult = await tryTursoOperation('deleteCustomerAndDebts', params);
    if (tursoResult) return tursoResult;
    const { operationId, customerId, customerName, customerCedula } = params;
    const customerRef = doc(db, 'clientes', customerId);
    let result: any = null;
    const opId = String(operationId || customerId);
    await runTransaction(db, async tx => {
      const operationRef = await claimOperation(tx, 'ELIMINAR-CLIENTE', opId);
      const customerSnap = await tx.get(customerRef);
      if (!customerSnap.exists()) throw new Error('El cliente ya no existe o fue eliminado en otra caja.');
      const customer = sanitizeForFirestore(customerSnap.data()) as any;
      // Evita leer toda CxC: cuando conocemos la cédula, el formato
      // canónico de cliente permite consultar únicamente las deudas de esa persona.
      // Solo usamos la consulta histórica amplia como compatibilidad para datos
      // antiguos que no contienen la cédula en el campo cliente.
      let debtsSnap;
      if (customerCedula) {
        const clienteExact = `${customerName || customer.cliente || customer.nombre || ''} [${customerCedula}]`.trim();
        debtsSnap = await tx.get(query(
          collection(db, 'cxc'),
          where('cliente', '==', clienteExact)
        ));
        // Compatibilidad con deudas antiguas que guardaban solo el nombre:
        // solo hacemos esta segunda lectura si la consulta canónica no encontró
        // nada. En datos nuevos el camino habitual sigue siendo una sola query.
        if (debtsSnap.empty) {
          const legacyName = String(customerName || customer.cliente || customer.nombre || '').trim();
          if (legacyName) {
            debtsSnap = await tx.get(query(
              collection(db, 'cxc'),
              where('cliente', '==', legacyName)
            ));
          }
        }
      } else if (customerName) {
        debtsSnap = await tx.get(query(
          collection(db, 'cxc'),
          where('cliente', '==', customerName)
        ));
      } else {
        debtsSnap = await tx.get(query(collection(db, 'cxc')));
      }
      const debts = debtsSnap.docs;
      const active = debts.find(d => {
        const debt = d.data() as any;
        return debt.estado !== 'pagada' && (Number(debt.saldoUSD) || 0) > 0.001;
      });
      if (active) throw new Error('El cliente tiene una deuda pendiente en otra caja. Actualice y vuelva a intentar.');
      debts.forEach(d => tx.delete(d.ref));
      tx.delete(customerRef);
      tx.set(operationRef, { tipo: 'ELIMINAR-CLIENTE', operationId: opId, fecha: new Date().toISOString(), referencia: customerId }, { merge: false });
      result = { customer, deletedDebts: debts.length };
    });
    return result;
  },

  async deleteCustomerDebtTransaction(params: {
    operationId?: string;
    debtId: string;
    customerCedula?: string;
    customerId?: string;
  }): Promise<any> {
    if (typeof window === 'undefined' || !db) return null;
    const tursoResult = await tryTursoOperation('deleteCustomerDebt', params);
    if (tursoResult) return tursoResult;
    const { operationId, debtId, customerCedula, customerId } = params;
    const debtRef = doc(db, 'cxc', debtId);
    let result: any = null;
    const opId = String(operationId || debtId);
    await runTransaction(db, async tx => {
      const operationRef = await claimOperation(tx, 'ELIMINAR-CXC', opId);
      const debtSnap = await tx.get(debtRef);
      if (!debtSnap.exists()) throw new Error('La deuda ya no existe o fue eliminada en otra caja.');
      const debt = sanitizeForFirestore(debtSnap.data()) as any;
      const saldo = Number(debt.saldoUSD) || 0;
      let customerRef: any = null;
      let customer: any = null;
      if (customerId) {
        customerRef = doc(db, 'clientes', customerId);
        const snap = await tx.get(customerRef);
        if (snap.exists()) customer = sanitizeForFirestore(snap.data()) as any;
      } else if (customerCedula) {
        const snaps = await tx.get(query(collection(db, 'clientes'), where('cedula', '==', customerCedula), limit(1)));
        if (!snaps.empty) {
          customerRef = snaps.docs[0].ref;
          customer = sanitizeForFirestore(snaps.docs[0].data()) as any;
        }
      }
      tx.delete(debtRef);
      if (customerRef && customer) {
        tx.set(customerRef, { debt: Math.max(0, (Number(customer.debt) || 0) - saldo) }, { merge: true });
      }
      tx.set(operationRef, { tipo: 'ELIMINAR-CXC', operationId: opId, fecha: new Date().toISOString(), referencia: debtId }, { merge: false });
      result = { debt, customer: customer ? { ...customer, debt: Math.max(0, (Number(customer.debt) || 0) - saldo) } : null };
    });
    // CxC/clientes se actualizan exclusivamente por snapshots completos autoritativos.
    return result;
  },

  async createCustomerDebtTransaction(params: {
    operationId?: string;
    debt: any;
    customer?: any;
    customerId?: string;
    customerCedula?: string;
    journal?: any;
  }): Promise<any> {
    if (typeof window === 'undefined') return null;
    // Turso es la fuente operativa; db es un marcador legacy retirado.
    // No debemos salir aquí antes de ejecutar la operación contra Turso.
    const tursoResult = await tryTursoOperation('customerDebt', params);
    if (tursoResult) {
      // La operación en Turso ya es autoritativa, pero la UI mantiene un
      // cache reactivo local. Aplicamos inmediatamente el registro canónico
      // devuelto por Turso para que Dashboard, CxC y POS vean al nuevo cliente
      // y su deuda sin tener que salir y volver a entrar al módulo.
      if (tursoResult.debt) {
        applyPatch({ cxc: mergeById(cache.cxc, [tursoResult.debt]) });
      }
      if (tursoResult.customer) {
        applyPatch({ clientes: mergeById(cache.clientes, [tursoResult.customer]) });
      }
      return tursoResult;
    }
    const { operationId, debt, customer, customerId, customerCedula, journal } = params;
    const debtRef = doc(db, 'cxc', debt.id);
    let result: any = null;
    const opId = String(operationId || debt.id);
    await runTransaction(db, async tx => {
      const operationRef = await claimOperation(tx, 'DEUDA-CXC', opId);
      const existing = await tx.get(debtRef);
      if (existing.exists()) throw new Error('La deuda ya existe en otra caja. Actualice y vuelva a intentar.');
      let customerRef: any = null;
      let remoteCustomer: any = null;
      if (customerId) {
        customerRef = doc(db, 'clientes', customerId);
        const snap = await tx.get(customerRef);
        if (!snap.exists()) throw new Error('El cliente ya no existe en otra caja.');
        remoteCustomer = sanitizeForFirestore(snap.data()) as any;
      } else if (customerCedula) {
        const snaps = await tx.get(query(collection(db, 'clientes'), where('cedula', '==', customerCedula), limit(1)));
        if (!snaps.empty) {
          customerRef = snaps.docs[0].ref;
          remoteCustomer = sanitizeForFirestore(snaps.docs[0].data()) as any;
        }
      }
      if (!remoteCustomer && customer) {
        customerRef = doc(db, 'clientes', customer.id);
        const snap = await tx.get(customerRef);
        if (snap.exists()) remoteCustomer = sanitizeForFirestore(snap.data()) as any;
        else tx.set(customerRef, sanitizeForFirestore(customer), { merge: false });
      }
      const amount = Number(debt.montoUSD) || 0;
      const mergedCustomer = remoteCustomer ? {
        ...remoteCustomer,
        debt: (Number(remoteCustomer.debt) || 0) + amount,
        address: customer?.address || remoteCustomer.address || 'Sin dirección',
        phone: customer?.phone || remoteCustomer.phone || 'Sin teléfono'
      } : null;
      if (customerRef && mergedCustomer) tx.set(customerRef, sanitizeForFirestore(mergedCustomer), { merge: true });
      tx.set(debtRef, sanitizeForFirestore(debt), { merge: false });
      if (journal?.id) tx.set(doc(db, 'libroDiario', journal.id), sanitizeForFirestore(journal), { merge: false });
      tx.set(operationRef, { tipo: 'DEUDA-CXC', operationId: opId, fecha: debt.fecha, referencia: debt.id }, { merge: false });
      result = { debt, customer: mergedCustomer };
    });
    // CxC/clientes se actualizan exclusivamente por snapshots completos autoritativos.
    if (journal?.id) applyPatch({ libroDiario: mergeById(cache.libroDiario, [journal]) });
    return result;
  },

  async reverseDebtPaymentTransaction(params: {
    operationId?: string;
    collection: 'cxc' | 'cxp';
    debtId: string;
    paymentId: string;
    journalId?: string;
  }): Promise<any | null> {
    if (typeof window === 'undefined' || !db) return null;
    const tursoResult = await tryTursoOperation('reverseDebtPayment', params);
    if (tursoResult) return tursoResult;
    const { operationId, collection: collectionName, debtId, paymentId, journalId } = params;
    const debtRef = doc(db, collectionName, debtId);
    let result: any = null;
    let journalResult: any = null;
    const opId = String(operationId || (collectionName + '|' + debtId + '|' + paymentId + '|REVERSE'));

    await runTransaction(db, async tx => {
      const operationRef = await claimOperation(tx, 'REVERSAR-PAGO', opId);
      // Cada reintento debe reconstruir completamente el resultado a partir
      // del estado remoto para evitar residuos de un intento anterior.
      let nextResult: any = null;
      let nextJournalResult: any = null;

      const debtSnap = await tx.get(debtRef);
      if (!debtSnap.exists()) throw new Error('La deuda ya no existe.');

      const journalRef = journalId ? doc(db, 'libroDiario', journalId) : null;
      const journalSnap = journalRef ? await tx.get(journalRef) : null;

      const remote = sanitizeForFirestore(debtSnap.data()) as any;
      const historial = Array.isArray(remote.historialPagos) ? [...remote.historialPagos] : [];
      const idx = historial.findIndex((p: any) => String(p?.id || '') === String(paymentId));
      if (idx < 0) throw new Error('El abono ya fue eliminado o no existe en la deuda remota.');

      const pago = historial[idx];
      const monto = Number(pago?.montoUSD) || 0;
      const restantes = historial.filter((_: any, i: number) => i !== idx);
      const abonado = Math.max(
        0,
        Math.round((restantes.reduce((sum: number, p: any) => sum + (Number(p?.montoUSD) || 0), 0) + Number.EPSILON) * 100) / 100
      );
      const saldo = Math.max(
        0,
        Math.round(((Number(remote.montoUSD) || 0) - abonado + Number.EPSILON) * 100) / 100
      );
      const estado = saldo <= 0.001 ? 'pagada' : abonado > 0 ? 'parcial' : 'pendiente';
      const updated = {
        ...remote,
        abonadoUSD: abonado,
        saldoUSD: saldo,
        estado,
        historialPagos: restantes
      };

      tx.set(debtRef, sanitizeForFirestore(updated), { merge: true });

      if (journalRef && journalSnap?.exists()) {
        const journal = sanitizeForFirestore(journalSnap.data()) as any;
        const nuevoMonto = Math.max(
          0,
          Math.round(((Number(journal.montoUSD) || 0) - monto + Number.EPSILON) * 100) / 100
        );
        const nuevoBS = Math.max(
          0,
          Math.round(((Number(journal.montoBS) || 0) - (Number(pago?.montoBS) || 0) + Number.EPSILON) * 100) / 100
        );

        if (nuevoMonto <= 0.001) {
          tx.delete(journalRef);
        } else {
          nextJournalResult = {
            ...journal,
            montoUSD: nuevoMonto,
            montoBS: nuevoBS,
            concepto: String(journal.concepto || '').replace(/ \\(abono revertido\\)$/i, '') + ' (abono revertido)'
          };
          tx.set(journalRef, sanitizeForFirestore(nextJournalResult), { merge: true });
        }
      }

      tx.set(operationRef, { tipo: 'REVERSAR-PAGO', operationId: opId, fecha: new Date().toISOString(), referencia: paymentId }, { merge: false });
      nextResult = { ...updated, reversedPayment: pago };
      result = nextResult;
      journalResult = nextJournalResult;
    });

    const currentJournal = (cache.libroDiario || []).filter((e: any) => e.id !== journalId);
    // La deuda CxC/CxP se actualiza por su snapshot completo autoritativo.
    // El asiento sí puede parchearse localmente porque libroDiario no usa snapshot completo.
    applyPatch({ libroDiario: journalResult ? [...currentJournal, journalResult] : currentJournal });

    return result;
  },

  async set(patch: Partial<AppState>) {
    if (typeof window === 'undefined') return;
    const prev = Store.get();
    const full = { ...initialState, ...prev, ...patch } as AppState;

    // Echo local inmediato (la UI ya muestra el cambio al instante)
    applyPatch(patch);

    // Cuando Turso está activo, las operaciones críticas de terminal/caja no
    // deben pasar por servidor Turso. La comparación se hace contra el cache anterior
    // y solo se envían los campos que realmente cambiaron.
    if (patch.terminales !== undefined) {
      const prevTerminals = (prev.terminales || []) as any[];
      const nextTerminals = (patch.terminales || []) as any[];

      // Corte Z: reporte + terminal/correlativo se confirman juntos.
      if (patch.reportesZ !== undefined) {
        const reportes = (patch.reportesZ || []) as any[];
        const previousReports = (prev.reportesZ || []) as any[];
        const newestReport = reportes.length ? reportes[reportes.length - 1] : null;
        const terminalId = String(newestReport?.terminalId || '');
        const terminal = nextTerminals.find((t: any) => String(t?.id || '') === terminalId);
        const previousTerminal = prevTerminals.find((t: any) => String(t?.id || '') === terminalId);
        if (newestReport && terminal && previousTerminal) {
          const terminalPatch: Record<string, any> = {};
          Object.keys(terminal).forEach(key => {
            if (key === 'id') return;
            if (JSON.stringify(terminal[key]) !== JSON.stringify(previousTerminal[key])) terminalPatch[key] = terminal[key];
          });
          const zResult = await tryTursoOperation('zClosure', {
            terminalId,
            report: newestReport,
            terminalPatch,
          });
          if (zResult) {
            const canonicalReport = zResult.report;
            applyPatch({
              reportesZ: [...previousReports, canonicalReport],
              terminales: mergeById(prevTerminals, [zResult.terminal]),
              ultimoZ: canonicalReport.numeroZ,
              fechaUltimoZ: canonicalReport.fecha,
              acumuladoHistorico: canonicalReport.acumuladoHistoricoUSD ?? cache.acumuladoHistorico,
              fondoCajaHoyBS: zResult.terminal.fondoCajaHoyBS ?? 0,
              fondoCajaHoyUSD: zResult.terminal.fondoCajaHoyUSD ?? 0,
              isCashOpen: !!zResult.terminal.isCashOpen,
            });
            return;
          }
        }
      }

      // Apertura/cierre de caja y demás cambios de una terminal.
      // Se procesa solo si existe una terminal previa; las altas/bajas de
      // terminales se mantienen en el flujo administrativo hasta activar
      // explícitamente la migración de gestión de terminales.
      for (const terminal of nextTerminals) {
        if (!terminal?.id) continue;
        const previous = prevTerminals.find((t: any) => String(t?.id || '') === String(terminal.id));
        if (!previous) continue;
        const terminalPatch: Record<string, any> = {};
        Object.keys(terminal).forEach(key => {
          if (key === 'id') return;
          if (JSON.stringify(terminal[key]) !== JSON.stringify(previous[key])) terminalPatch[key] = terminal[key];
        });
        if (Object.keys(terminalPatch).length === 0) continue;
        const result = await tryTursoOperation('terminalPatch', {
          terminalId: String(terminal.id),
          patch: terminalPatch,
        });
        if (result) {
          applyPatch({ terminales: mergeById(prevTerminals, [result.terminal]) });
          return;
        }
        break;
      }
    }

    // 1) COLEECCIONES: escritura por documento (nunca el array completo en un doc)
    const jobs: Promise<unknown>[] = [];
    for (const key of Object.keys(COLLECTIONS)) {
      const k = key as keyof AppState;
      if ((patch as any)[k] === undefined) continue;
      const prevArr = ((prev as any)[k] || []) as any[];
      const newArr = ((patch as any)[k] || []) as any[];
      if (k === 'productos') {
        const prevById = new Map(prevArr.filter(x => x?.id).map(x => [String(x.id), x]));
        const newById = new Map(newArr.filter(x => x?.id).map(x => [String(x.id), x]));
        const changes: Array<{ before?: any | null; after?: any | null }> = [];
        const deletedIds: string[] = [];
        newById.forEach((after, id) => {
          const before = prevById.get(id);
          if (!before || JSON.stringify(sanitizeForFirestore(before)) !== JSON.stringify(sanitizeForFirestore(after))) {
            changes.push({ before: before || null, after });
          }
        });
        prevById.forEach((_before, id) => { if (!newById.has(id)) deletedIds.push(id); });

        jobs.push((async () => {
          const result = await tryTursoOperation('productSync', { changes, deletedIds });
          if (result) {
            const canonical = Array.isArray(result.products) ? result.products : [];
            const next = mergeById(newArr, canonical).filter(p => !deletedIds.includes(String(p.id)));
            applyPatch({ productos: next });
            return;
          }

          // Turso no configurado: conserva el comportamiento servidor Turso existente.
          const stocks = await syncProductosTransactional(prevArr, newArr);
          let toSync = newArr;
          if (stocks && stocks.size > 0) {
            const corrected = newArr.map((p: any) => {
              const s = stocks.get(String(p.id));
              return s !== undefined ? { ...p, stock: s } : p;
            });
            applyPatch({ productos: corrected });
            toSync = corrected;
          }
          await syncProductosRTDB(prevArr, toSync);
        })().catch(e => console.error("Error persistiendo productos:", e)));
      } else if (k === 'terminales') {
        // Las terminales se escriben exclusivamente mediante terminalPatch/Upsert/Delete.
        // Si Turso está activo, no existe una vía genérica que pueda terminar en servidor Turso.
        if (navigator.onLine === false) {
          throw new Error('Sin conexión: no se modificará la terminal para evitar divergencia.');
        }
      } else if (['clientes', 'proveedores', 'movimientos', 'libroDiario'].includes(String(k))) {
        const prevById = new Map(prevArr.filter(x => x?.id).map(x => [String(x.id), x]));
        const newById = new Map(newArr.filter(x => x?.id).map(x => [String(x.id), x]));
        const records = [...newById.values()].filter((after: any) => {
          const before = prevById.get(String(after.id));
          return !before || JSON.stringify(sanitizeForFirestore(before)) !== JSON.stringify(sanitizeForFirestore(after));
        });
        const deletedIds = [...prevById.keys()].filter(id => !newById.has(id));

        jobs.push((async () => {
          const result = await tryTursoOperation('recordsSync', {
            table: String(k),
            records: sanitizeForFirestore(records),
            deletedIds,
          });
          if (result) {
            applyPatch({ [k]: mergeById(newArr, Array.isArray(result.records) ? result.records : []) });
            return;
          }
          await syncArrayToCollection(COLLECTIONS[k], prevArr, newArr);
        })().catch(e => console.error("Error persistiendo " + k + ":", e)));
      } else {
        jobs.push(syncArrayToCollection(COLLECTIONS[k], prevArr, newArr).catch(e => console.error("Error persistiendo " + k + ":", e)));
      }
    }

    // 2) CATÁLOGOS: Turso primero; servidor Turso solo mientras Turso no esté configurado.
    const catalogJobs: Promise<unknown>[] = [];
    let catalogosChanged = false;
    for (const [field, catName] of Object.entries(CATALOG_FIELDS)) {
      if ((patch as any)[field] === undefined) continue;
      const newList = (patch as any)[field] || [];
      const prevList = (prev as any)[field] || [];
      if (JSON.stringify(prevList) !== JSON.stringify(newList)) {
        catalogosChanged = true;
        catalogJobs.push((async () => {
          const result = await tryTursoOperation('catalogPatch', { name: catName, lista: sanitizeForFirestore(newList) });
          if (!result) await setDoc(doc(db, CATALOGOS_COLLECTION, catName), { lista: sanitizeForFirestore(newList) });
        })());
      }
    }
    if (catalogosChanged) {
      const catalogVersion = new Date().toISOString();
      jobs.push(Promise.all(catalogJobs).then(async () => {
        const result = await tryTursoOperation('configPatch', { patch: { catalogosVersion: catalogVersion } });
        if (!result) await setDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID), { catalogosVersion: catalogVersion }, { merge: true });
      }).then(() => writeCatalogCacheMeta(catalogVersion)).catch(e => console.error('Error persistiendo catálogo/version:', e)));
    }

    // 3) CONFIG: Turso es la única fuente de verdad. No se replica ni cae en servidor Turso.
    const toWrite: Record<string, any> = {};
    for (const f of CONFIG_FIELDS) {
      const key = f as keyof AppState;
      if ((patch as any)[f] === undefined) continue;
      const clean = sanitizeForFirestore((patch as any)[f]);
      if (clean === undefined) continue;
      if (JSON.stringify(prev[key]) !== JSON.stringify((patch as any)[f])) toWrite[f] = clean;
    }
    if (Object.keys(toWrite).length > 0) {
      jobs.push((async () => {
        const result = await tryTursoOperation('configPatch', { patch: toWrite });
        if (!result) throw new Error('Turso no confirmó la actualización de configuración.');
      })().catch(e => console.error('Error persistiendo config:', e)));
    }
    await Promise.all(jobs);
  },

  async patchConfig(patch: Partial<AppState>): Promise<AppState> {
    if (typeof window === 'undefined') return Store.get();
    const cleanPatch: Record<string, any> = {};
    for (const key of CONFIG_FIELDS) {
      if ((patch as any)[key] !== undefined) cleanPatch[key] = sanitizeForFirestore((patch as any)[key]);
    }
    if (Object.keys(cleanPatch).length === 0) return Store.get();
    const result = await tryTursoOperation('configPatch', { patch: cleanPatch });
    if (!result?.config) throw new Error('Turso no confirmó la actualización de configuración.');
    const applied: any = {};
    for (const key of CONFIG_FIELDS) if (result.config[key] !== undefined) applied[key] = sanitizeForFirestore(result.config[key]);
    applyPatch(applied);
    return Store.get();
  },

  loadMore,
  ensureLoaded,
  ensureReportRange,
  startMasterSync,
  syncMasterSync,
  startTerminalSync,
  ensureReportData,
  kardex,
  getSaleById,

  uid(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }
};

registerOfflineProcessor(async (operation) => {
  if (operation.type === 'VENTA') {
    await Store.createSaleTransaction({ ...(operation.payload || {}), fromOfflineQueue: true, operationId: operation.operationId });
    return;
  }
  if (operation.type === 'INVENTARIO') {
    await Store.applyInventoryMovementsTransaction({ ...(operation.payload || {}), fromOfflineQueue: true, operationId: operation.operationId });
    return;
  }
  if (operation.type === 'COMPRA') { await Store.createPurchaseTransaction({ ...(operation.payload || {}), operationId: operation.operationId }); return; }
  if (operation.type === 'PAGO-DEUDA') { await Store.applyDebtPaymentTransaction({ ...(operation.payload || {}), operationId: operation.operationId }); return; }
  if (operation.type === 'PAGO-CXP-GLOBAL') { await Store.applyGlobalProviderPaymentTransaction({ ...(operation.payload || {}), operationId: operation.operationId }); return; }
  if (operation.type === 'REVERSAR-PAGO') { await Store.reverseDebtPaymentTransaction({ ...(operation.payload || {}), operationId: operation.operationId }); return; }
  if (operation.type === 'ELIMINAR-COMPRA') { await Store.deletePurchaseTransaction({ ...(operation.payload || {}), operationId: operation.operationId }); return; }
  if (operation.type === 'ELIMINAR-CLIENTE') { await Store.deleteCustomerAndDebtsTransaction({ ...(operation.payload || {}), operationId: operation.operationId }); return; }
  if (operation.type === 'ELIMINAR-CXC') { await Store.deleteCustomerDebtTransaction({ ...(operation.payload || {}), operationId: operation.operationId }); return; }
  if (operation.type === 'DEUDA-CXC') { await Store.createCustomerDebtTransaction({ ...(operation.payload || {}), operationId: operation.operationId }); return; }
  if (operation.type === 'DEUDA-CXP') { await Store.createSupplierDebtTransaction({ ...(operation.payload || {}), operationId: operation.operationId }); return; }
  if (operation.type === 'DEVOLUCION' || operation.type === 'ANULACION') { await Store.processReturnOrCancellationTransaction({ ...(operation.payload || {}), operationId: operation.operationId }); return; }
  throw new Error('Tipo de operación offline no soportado: ' + operation.type);
});

export const Utils = {
  getVzlaDate: () => {
    const d = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'America/Caracas',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    };
    const formatter = new Intl.DateTimeFormat('en-CA', options);
    const parts = formatter.formatToParts(d);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value;
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}.${ms}`;
  },
  hoy: () => Utils.getVzlaDate().slice(0, 10),
  ahora: () => Utils.getVzlaDate(),
  round: (v: any) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : Math.round((n + Number.EPSILON) * 100) / 100;
  },
  fmtUSD: (v: number) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  fmtBS: (v: number, symbol = true) => (symbol ? 'Bs. ' : '') + Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  fmtMono: (v: number, prefix = false) => (prefix ? '$' : '') + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  fmtFecha: (f: string) => {
    if (!f) return '-';
    const datePart = f.includes('T') ? f.split('T')[0] : f;
    const p = datePart.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  },
  metodoLabel: (m: string) => {
    const map: Record<string, string> = {
      efectivo_usd: 'Efectivo USD',
      efectivo_bs: 'Efectivo Bs.',
      punto_venta: 'Punto de Venta',
      biopago: 'Biopago',
      pagomovil: 'PagoMovil',
      zelle: 'Zelle',
      credito: 'Crédito',
      mixto: 'Mixto',
      nota_credito: 'Vale / Nota Crédito',
      otros: 'Otros'
    };
    return map[m] || m;
  },

  // Prefijo de caja para la numeración de facturas. Cada caja lleva una serie
  // propia (C1-, C2-, ...) de modo que dos cajas puedan tener el mismo correlativo
  // pero queden diferenciadas en facturas, reportes y asientos.
  prefijoCaja: (t?: Terminal | null, terminals?: Terminal[]): string => {
    if (t?.prefijoCaja) return t.prefijoCaja;
    if (t?.id) {
      const idx = (terminals || []).findIndex(x => x.id === t.id);
      return 'C' + (idx >= 0 ? idx + 1 : 1);
    }
    return 'G';
  },

  // Lee el estado de caja de UN terminal concreto (apertura, fondos, corte Z,
  // historial). Fuente de verdad: el documento del terminal.
  getTerminalCash: (t?: Terminal | null) => {
    return {
      isCashOpen: !!t?.isCashOpen,
      cashData: t?.cashData ?? null,
      fondoCajaHoyUSD: t?.fondoCajaHoyUSD ?? 0,
      fondoCajaHoyBS: t?.fondoCajaHoyBS ?? 0,
      ultimoZ: t?.ultimoZ ?? 0,
      fechaUltimoZ: t?.fechaUltimoZ ?? '',
      acumuladoHistorico: t?.acumuladoHistorico ?? 0,
      cashHistory: t?.cashHistory ?? [],
      proximoRecibo: t?.proximoRecibo ?? 0,
      proximaDevolucion: t?.proximaDevolucion ?? 0,
      proximaAnulacion: t?.proximaAnulacion ?? 0,
    };
  },

  // Actualiza el estado de caja de un terminal dentro del array de terminales.
  // Devuelve el nuevo array listo para pasar a updateState({ terminales: ... }).
  patchTerminal: (terminales: Terminal[], terminalId: string | undefined, patch: Partial<Terminal>): Terminal[] => {
    if (!terminalId) return terminales;
    return terminales.map(t => t.id === terminalId ? { ...t, ...patch } : t);
  },

  // Recalcula el saldo (stockAntes/stockDespues) de TODOS los movimientos de un
  // producto en orden cronológico. Se usa al registrar una compra con fecha pasada:
  // además de asentar el movimiento en esa fecha, los movimientos posteriores deben
  // reflejar el nuevo saldo corrido hasta la fecha actual.
  // `newIds` = ids de los movimientos recién insertados; la base (saldo de apertura)
  // se toma del movimiento pre-existente más antiguo, para no perder el stock inicial.
  recalcularSaldoProducto: (movimientos: Movimiento[], productoId: string, newIds?: Set<string>): Movimiento[] => {
    const others = movimientos.filter(m => m.productoId !== productoId);
    const productMovs = movimientos
      .filter(m => m.productoId === productoId)
      .slice()
      .sort((a, b) => (a.fecha === b.fecha ? 0 : a.fecha < b.fecha ? -1 : 1));
    // Saldo de apertura: stockAntes del primer movimiento pre-existente (0 si no hay).
    let base = 0;
    for (const m of productMovs) {
      if (!newIds || !newIds.has(m.id)) { base = m.stockAntes || 0; break; }
    }
    let balance = base;
    const updated = productMovs.map(m => {
      const stockAntes = balance;
      const stockDespues = stockAntes + (m.cantidad || 0);
      balance = stockDespues;
      return { ...m, stockAntes, stockDespues };
    });
    return [...others, ...updated];
  }
};
