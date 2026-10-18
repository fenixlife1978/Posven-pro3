'use client';

import { AppState } from './types';
import { db, rtdb } from './firebase';
import {
  collection, doc, getDoc, getDocs, getCountFromServer, onSnapshot, orderBy, limit, query, setDoc, where,
  writeBatch, runTransaction, startAfter
} from "firebase/firestore";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { onValue, ref, update, remove, get as rtdbGet } from "firebase/database";

const STORAGE_KEY = 'posven_pro_session_data_cache';
const PAGE_SIZE = 10;
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

// Campos de configuración que se guardan en config/general (nunca en state)
const CONFIG_FIELDS = [
  'tasa', 'pinDevolucion', 'isInitialized', 'empresa',
  'proximoRecibo', 'proximaDevolucion', 'proximaAnulacion',
  'ultimoZ', 'fechaUltimoZ', 'acumuladoHistorico',
  'fondoCajaHoyUSD', 'fondoCajaHoyBS', 'isCashOpen', 'cashData', 'config',
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
    return d ? (JSON.parse(d) as Partial<AppState>) : {};
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
      const serialized = JSON.stringify(cache);
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

// Escribe SOLO los documentos que cambiaron/crearon/eliminaron en la colección.
function syncArrayToCollection(name: string, prevArr: any[] | undefined, newArr: any[] | undefined): Promise<void> {
  if (!db) return Promise.resolve();
  const prevList = prevArr || [];
  const newList = newArr || [];
  const prevById = new Map(prevList.filter(x => x && x.id).map(x => [String(x.id), x]));
  const newIds = new Set(newList.filter(x => x && x.id).map(x => String(x.id)));

  const batch = writeBatch(db);
  let ops = 0;
  newList.forEach(x => {
    if (!x || !x.id) return;
    const before = prevById.get(String(x.id));
    const clean = sanitizeForFirestore(x);
    if (!before || JSON.stringify(sanitizeForFirestore(before)) !== JSON.stringify(clean)) {
      batch.set(doc(db, name, String(x.id)), clean, { merge: true });
      ops++;
    }
  });
  prevById.forEach((_x, id) => {
    if (!newIds.has(id)) {
      batch.delete(doc(db, name, id));
      ops++;
    }
  });
  if (ops === 0) return Promise.resolve();
  return batch.commit();
}

// Stock atómico entre cajas (transacciones): calcula deltas por producto y los aplica contra el
// stock REAL de Firestore para que dos cajas no se pisen el inventario.
function syncProductosTransactional(prevArr: any[] | undefined, newArr: any[] | undefined): Promise<Map<string, number> | undefined> {
  if (!db) return Promise.resolve(undefined);
  const prevList = prevArr || [];
  const newList = newArr || [];
  const prevById = new Map(prevList.filter(x => x && x.id).map(x => [String(x.id), x]));
  const newById = new Map(newList.filter(x => x && x.id).map(x => [String(x.id), x]));

  const createdIds = [...newById.keys()].filter(id => !prevById.has(id));
  const changedIds = [...newById.keys()].filter(id =>
    prevById.has(id) &&
    JSON.stringify(sanitizeForFirestore(prevById.get(id))) !== JSON.stringify(sanitizeForFirestore(newById.get(id)))
  );
  const removedIds = [...prevById.keys()].filter(id => !newById.has(id));

  if (createdIds.length === 0 && changedIds.length === 0 && removedIds.length === 0) return Promise.resolve(new Map());

  return runTransaction(db, async (tx) => {
    const finalStocks = new Map<string, number>();
    for (const id of createdIds) {
      const prod = newById.get(id) || {};
      tx.set(doc(db, 'productos', id), sanitizeForFirestore(prod), { merge: true });
      finalStocks.set(id, typeof prod.stock === 'number' ? prod.stock : 0);
    }
    for (const id of changedIds) {
      const prevP = prevById.get(id) || {};
      const newP = newById.get(id) || {};
      const prevStock = typeof prevP.stock === 'number' ? prevP.stock : 0;
      const newStock = typeof newP.stock === 'number' ? newP.stock : 0;
      const delta = newStock - prevStock;
      const ref = doc(db, 'productos', id);
      const snap = await tx.get(ref);
      const remote = snap.exists() ? snap.data() : null;
      const baseStock = remote && typeof remote.stock === 'number' ? remote.stock : (delta === 0 ? newStock : 0);
      const finalStock = baseStock + delta;
      tx.set(ref, sanitizeForFirestore({ ...newP, stock: finalStock }), { merge: true });
      finalStocks.set(id, finalStock);
    }
    for (const id of removedIds) {
      tx.delete(doc(db, 'productos', id));
    }
    return finalStocks;
  }).catch(async (e) => {
    console.error("Error transaccional productos:", e);
    await syncArrayToCollection('productos', prevArr, newArr);
    return undefined;
  });
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
  const rootRef = ref(rtdb, RTDB_PRODUCTS_PATH);
  return Promise.resolve()
    .then(() => Object.keys(updates).length > 0 ? update(rootRef, updates) : undefined)
    .then(() => removals.length > 0
      ? Promise.all(removals.map(id => remove(ref(rtdb, RTDB_PRODUCTS_PATH + '/' + id))).concat([]))
      : undefined)
    .catch(e => console.error('RTDB sync productos:', e));
}

// Sincroniza el espejo RTDB con Firestore (migración y sanado):
//  - Si el espejo está vacío → lo siembra COMPLETO desde Firestore.
//  - Si está incompleto (menos productos que Firestore) → lo repuebla completo.
// Firestore sigue siendo la fuente de verdad; RTDB es el espejo barato de tiempo real.
async function bootstrapProductos(): Promise<void> {
  if (!rtdb || !db) return;
  try {
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
      return;
    }

    applyPatch({ productos: mergeById((cache as any).productos, mirrorItems) });
    const count = await getCountFromServer(query(collection(db, 'productos'))).catch(() => null);
    if (count && count.data().count !== mirrorItems.length) {
      const items = await loadCollection('productos');
      if (items.length > 0) {
        const updates: Record<string, any> = {};
        items.forEach(p => { updates[String(p.id)] = sanitizeForFirestore(p); });
        await update(ref(rtdb, RTDB_PRODUCTS_PATH), updates);
      }
    }
  } catch (e) {
    console.error('bootstrapProductos:', e);
  }
}

// ============================================================
// LECTURAS
// ============================================================
const loadedAll: Record<string, boolean> = {};
const cursors: Record<string, QueryDocumentSnapshot<DocumentData> | null> = {};

async function loadCollection(name: string): Promise<any[]> {
  if (!db) return [];
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => sanitizeForFirestore(d.data())).filter(Boolean);
}

// Carga COMPLETA de una colección paginada de 500 (evita leer doc a doc en loops).
async function loadAll(name: string): Promise<void> {
  if (!db || loadedAll[name]) return;
  loadedAll[name] = true;
  const col = COLLECTIONS[name];
  if (!col) return;
  try {
    const all: any[] = [];
    let lastDoc: any = null;
    do {
      const q = lastDoc
        ? query(collection(db, col), orderBy('fecha', 'desc'), startAfter(lastDoc), limit(500))
        : query(collection(db, col), orderBy('fecha', 'desc'), limit(500));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => sanitizeForFirestore(d.data())).filter(Boolean);
      all.push(...items);
      lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
      if (snap.docs.length < 500) break;
    } while (lastDoc);
    applyPatch({ [name]: mergeById((cache as any)[name], all) });
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
  if (!db) return;
  if (loadingPromises[name]) return loadingPromises[name];
  const p = (async () => {
    loadedAll[name] = true;
    try {
      const items = await loadCollection(name);
      applyPatch({ [name]: mergeById((cache as any)[name], items) });
    } catch (e) {
      console.error("Error cargando " + name + ":", e);
      loadedAll[name] = false;
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
async function ensureReportData(): Promise<void> {
  if (!db) return;
  await Promise.all([
    ensureLoaded('ventas'),
    ensureLoaded('devoluciones'),
    ensureLoaded('anulaciones'),
    ensureLoaded('libroDiario'),
    ensureLoaded('terminales'),
    ensureLoaded('clientes'),
  ]);
}

// Siguiente página (10) de una colección ordenada por fecha desc (listas históricas).
async function loadMore(name: string, pageSize: number = PAGE_SIZE): Promise<number> {
  const col = COLLECTIONS[name];
  if (!col || !db) return 0;
  try {
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

// Carga SOLO los registros posteriores al último cierre Z (los módulos del POS
// filtran por fecha > fechaUltimoZ, así que con eso basta). Evita re-leer el
// histórico completo (miles de docs) en cada sesión. Se re-ejecuta cuando cambia
// fechaUltimoZ (tras cada Reporte Z).
const SINCE_STAMP: Record<string, string> = {};
async function loadSinceLastZ(listName: string): Promise<void> {
  const col = COLLECTIONS[listName];
  if (!col || !db) return;
  const desde = (cache as any).fechaUltimoZ || '';
  if (SINCE_STAMP[listName] === desde) return;
  SINCE_STAMP[listName] = desde;
  try {
    const q = query(collection(db, col), where('fecha', '>', desde), limit(500));
    const snap = await getDocs(q);
    const items = snap.docs.map(d => sanitizeForFirestore(d.data())).filter(Boolean);
    applyPatch({ [listName]: mergeById((cache as any)[listName], items) });
  } catch (e) {
    console.error("loadSinceLastZ " + listName + ":", e);
  }
}

// Kardex de un producto (where + orden). Si falta el índice compuesto, carga y filtra en memoria.
async function kardex(productoId: string, max = 100): Promise<any[]> {
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
}

async function loadCatalogs() {
  if (!db) return;
  const patch: any = {};
  for (const [field, catName] of Object.entries(CATALOG_FIELDS)) {
    try {
      const snap = await getDoc(doc(db, CATALOGOS_COLLECTION, catName));
      if (snap.exists()) patch[field] = snap.data().lista || [];
    } catch (e) {
      console.warn("Catálogo " + catName + ":", e);
    }
  }
  if (Object.keys(patch).length > 0) applyPatch(patch);
}

// ============================================================
// INICIALIZACIÓN DE LISTENERS
// ============================================================
let started = false;
let teardownFns: (() => void)[] = [];

function cleanup() {
  teardownFns.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  teardownFns = [];
  started = false;
  Object.keys(loadedAll).forEach(k => { loadedAll[k] = false; });
  Object.keys(cursors).forEach(k => { cursors[k] = null; });
}

function init() {
  if (started) return;
  started = true;
  if (!db || typeof window === 'undefined') return;

  // 1) CONFIG (doc pequeño, en vivo)
  teardownFns.push(onSnapshot(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID), (snap) => {
    if (!snap.exists()) return;
    const val = snap.data();
    const patch: any = {};
    for (const f of CONFIG_FIELDS) {
      if (val[f] !== undefined) patch[f] = sanitizeForFirestore(val[f]);
    }
    if (Object.keys(patch).length > 0) applyPatch(patch);
    if (patch.fechaUltimoZ !== undefined) {
      loadSinceLastZ('ventas');
      loadSinceLastZ('libroDiario');
    }
  }, (err) => { if (err.code !== 'permission-denied') console.warn("Sync config:", err); }));

  // 2) PRODUCTOS (tiempo real vía RTDB: el espejo evita re-leer la colección en cada venta).
  bootstrapProductos();
  if (rtdb) {
    teardownFns.push(onValue(ref(rtdb, RTDB_PRODUCTS_PATH), (snap) => {
      const val = snap.val() || {};
      const items = Object.values(val).filter(Boolean);
      applyPatch({ productos: mergeById((cache as any).productos, items) });
    }, (err) => { if (err?.code !== 'permission-denied') console.warn("RTDB productos:", err); }));
  }

  // 3) LISTAS VIVAS ACOTADAS a las últimas 30 (tiempo real barato entre cajas)
  for (const name of ['ventas', 'movimientos', 'cxc', 'cxp']) {
    const col = COLLECTIONS[name];
    teardownFns.push(onSnapshot(
      query(collection(db, col), orderBy('fecha', 'desc'), limit(30)),
      (snap) => {
        const items = snap.docs.map(d => sanitizeForFirestore(d.data())).filter(Boolean);
        applyPatch({ [name]: mergeById((cache as any)[name], items) });
      },
      (err) => { if (err.code !== 'permission-denied') console.warn("Sync " + name + ":", err); }
    ));
  }

  // 4) CARGA INICIAL: listas pequeñas completas + solo lo posterior al último Z
  //    para ventas/libroDiario (los módulos del POS filtran por fecha > fechaUltimoZ).
  //    El histórico completo se carga bajo demanda cuando se abre el módulo que lo necesita.
  ['cxc', 'cxp', 'clientes', 'proveedores', 'terminales', 'devoluciones', 'anulaciones', 'reportesZ', 'caja', 'compras'].forEach(ensureLoaded);
  loadSinceLastZ('ventas');
  loadSinceLastZ('libroDiario');

  // 5) CATÁLOGOS
  loadCatalogs();
}

// ============================================================
// API PÚBLICA
// ============================================================
export const Store = {
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

  async set(patch: Partial<AppState>) {
    if (typeof window === 'undefined' || !db) return;
    const prev = Store.get();
    const full = { ...initialState, ...prev, ...patch } as AppState;

    // Echo local inmediato (la UI ya muestra el cambio al instante)
    applyPatch(patch);

    // 1) COLEECCIONES: escritura por documento (nunca el array completo en un doc)
    const jobs: Promise<unknown>[] = [];
    for (const key of Object.keys(COLLECTIONS)) {
      const k = key as keyof AppState;
      if ((patch as any)[k] === undefined) continue;
      const prevArr = ((prev as any)[k] || []) as any[];
      const newArr = ((patch as any)[k] || []) as any[];
      if (k === 'productos') {
        jobs.push(syncProductosTransactional(prevArr, newArr)
          .then((stocks) => {
            let toSync = newArr;
            if (stocks && stocks.size > 0) {
              const corrected = newArr.map((p: any) => {
                const s = stocks.get(String(p.id));
                return s !== undefined ? { ...p, stock: s } : p;
              });
              applyPatch({ productos: corrected });
              toSync = corrected;
            }
            return syncProductosRTDB(prevArr, toSync);
          })
          .catch(e => console.error("Error persistiendo productos:", e)));
      } else {
        jobs.push(syncArrayToCollection(COLLECTIONS[k], prevArr, newArr).catch(e => console.error("Error persistiendo " + k + ":", e)));
      }
    }

    // 2) CATÁLOGOS
    for (const [field, catName] of Object.entries(CATALOG_FIELDS)) {
      if ((patch as any)[field] === undefined) continue;
      const newList = (patch as any)[field] || [];
      const prevList = (prev as any)[field] || [];
      if (JSON.stringify(prevList) !== JSON.stringify(newList)) {
        jobs.push(setDoc(doc(db, CATALOGOS_COLLECTION, catName), { lista: sanitizeForFirestore(newList) })
          .catch(e => console.error("Error persistiendo catálogo " + catName + ":", e)));
      }
    }

    // 3) CONFIG (config/general) — solo campos que cambiaron
    const toWrite: Record<string, any> = {};
    for (const f of CONFIG_FIELDS) {
      const key = f as keyof AppState;
      if ((patch as any)[f] === undefined) continue;
      const clean = sanitizeForFirestore((patch as any)[f]);
      if (clean === undefined) continue;
      if (JSON.stringify(prev[key]) !== JSON.stringify((patch as any)[f])) {
        toWrite[f] = clean;
      }
    }
    if (Object.keys(toWrite).length > 0) {
      jobs.push(setDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID), toWrite, { merge: true })
        .catch(e => console.error("Error persistiendo config:", e)));
    }

    await Promise.all(jobs);
  },

  loadMore,
  ensureLoaded,
  ensureReportData,
  kardex,

  uid(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }
};

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
  }
};
