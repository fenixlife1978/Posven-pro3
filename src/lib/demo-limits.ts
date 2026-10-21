import { tursoInteractiveTransaction, type TursoStatement } from '@/lib/turso/client';

export type DemoAction = 'sales' | 'purchases' | 'items';
export const DEMO_LIMIT = 10;
const ACTION_LABEL: Record<DemoAction, string> = {
  sales: 'ventas',
  purchases: 'compras',
  items: 'nuevos ítems',
};

function enabled() {
  return process.env.POSVEN_DEMO_BUILD === '1';
}

async function init(tx: { execute: (statement: TursoStatement) => Promise<any> }) {
  await tx.execute({ sql: 'CREATE TABLE IF NOT EXISTS demo_usage (action TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0)', wantRows: false });
  for (const action of ['sales', 'purchases', 'items']) {
    await tx.execute({ sql: 'INSERT INTO demo_usage(action, used) VALUES(?, 0) ON CONFLICT(action) DO NOTHING', args: [action], wantRows: false });
  }
}

export async function getDemoUsage() {
  if (!enabled()) return { demo: false, limit: DEMO_LIMIT, used: { sales: 0, purchases: 0, items: 0 }, remaining: { sales: DEMO_LIMIT, purchases: DEMO_LIMIT, items: DEMO_LIMIT }, locked: false };
  return tursoInteractiveTransaction(async tx => {
    await init(tx);
    const result = await tx.execute({ sql: 'SELECT action, used FROM demo_usage', wantRows: true });
    const used: Record<DemoAction, number> = { sales: 0, purchases: 0, items: 0 };
    for (const row of (result.rows || []) as Array<{action: DemoAction; used: number}>) used[row.action] = Number(row.used || 0);
    const remaining = { sales: Math.max(0, DEMO_LIMIT-used.sales), purchases: Math.max(0, DEMO_LIMIT-used.purchases), items: Math.max(0, DEMO_LIMIT-used.items) };
    return { demo: true, limit: DEMO_LIMIT, used, remaining, locked: Object.values(remaining).some(n => n === 0), exhausted: (Object.keys(remaining) as DemoAction[]).filter(k => remaining[k] === 0).map(k => ACTION_LABEL[k]) };
  });
}

export async function withDemoLimit<T>(action: DemoAction, work: () => Promise<T>, amount = 1): Promise<T> {
  if (!enabled()) return work();
  if (!Number.isInteger(amount) || amount < 1) throw new Error('Cantidad de acciones DEMO no válida.');
  await tursoInteractiveTransaction(async tx => {
    await init(tx);
    const result = await tx.execute({ sql: 'SELECT used FROM demo_usage WHERE action = ?', args: [action], wantRows: true });
    const used = Number((result.rows?.[0] as {used?: number} | undefined)?.used || 0);
    if (used + amount > DEMO_LIMIT) {
      throw new Error('DEMO agotada: máximo de 10 ' + ACTION_LABEL[action] + '. Adquiere POSVEN-PRO completo para continuar.');
    }
    await tx.execute({ sql: 'UPDATE demo_usage SET used = used + ? WHERE action = ?', args: [amount, action], wantRows: false });
  });
  try {
    return await work();
  } catch (error) {
    await tursoInteractiveTransaction(async tx => {
      await init(tx);
      await tx.execute({ sql: 'UPDATE demo_usage SET used = MAX(0, used - ?) WHERE action = ?', args: [amount, action], wantRows: false });
    });
    throw error;
  }
}
