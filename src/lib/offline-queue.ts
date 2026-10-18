const QUEUE_KEY = 'posven_pro_offline_operations_v1';

export type OfflineOperation = {
  operationId: string;
  type: string;
  payload: any;
  createdAt: string;
  status: 'pending' | 'processing' | 'processed' | 'conflict';
  attempts: number;
  lastError?: string;
  processedAt?: string;
};

type Processor = (op: OfflineOperation) => Promise<void>;
let processor: Processor | null = null;
let processing = false;
const listeners = new Set<(items: OfflineOperation[]) => void>();

function load(): OfflineOperation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function save(items: OfflineOperation[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items)); } catch (e) { console.error('[offline-queue] No se pudo guardar la cola:', e); }
  listeners.forEach(fn => { try { fn(items); } catch {} });
}

export function getOfflineQueue(): OfflineOperation[] { return load(); }
export function onOfflineQueueChange(fn: (items: OfflineOperation[]) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

export function enqueueOfflineOperation(type: string, payload: any, operationId: string): OfflineOperation {
  const items = load();
  const existing = items.find(x => x.operationId === operationId && x.status !== 'conflict');
  if (existing) return existing;
  const item: OfflineOperation = { operationId, type, payload, createdAt: new Date().toISOString(), status: 'pending', attempts: 0 };
  save([...items, item]);
  return item;
}

export function registerOfflineProcessor(fn: Processor) { processor = fn; }

export async function processOfflineQueue(): Promise<void> {
  if (processing || !processor || typeof window === 'undefined' || !navigator.onLine) return;
  processing = true;
  try {
    for (;;) {
      const current = load();
      const item = current.find(x => x.status === 'pending' || x.status === 'processing');
      if (!item) break;
      item.status = 'processing';
      item.attempts += 1;
      save(current);
      try {
        await processor(item);
        const next = load().filter(x => x.operationId !== item.operationId);
        save(next);
      } catch (e: any) {
        const latest = load();
        const target = latest.find(x => x.operationId === item.operationId);
        if (target) {
          target.status = navigator.onLine ? 'conflict' : 'pending';
          target.lastError = String(e?.message || e || 'Error de sincronización');
        }
        save(latest);
        if (!navigator.onLine) break;
        // Un conflicto no debe bloquear las demás operaciones pendientes.
        continue;
      }
    }
  } finally { processing = false; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void processOfflineQueue(); });
  window.setTimeout(() => { void processOfflineQueue(); }, 1500);
  window.setInterval(() => { void processOfflineQueue(); }, 15000);
}
