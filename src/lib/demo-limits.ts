import { tursoTransaction, tursoExecute } from '@/lib/turso/client';

export const DEMO_LIMIT = 10;
export const DEMO_TRACKED_MODULES = ['Ventas', 'Productos creados', 'Compras'] as const;
export type DemoTrackedModule = typeof DEMO_TRACKED_MODULES[number];

/** Atomically consumes one of the ten allowed demo actions for a tracked category. */
export async function reserveDemoAction(moduleName: string): Promise<boolean> {
  const results = await tursoTransaction([
    { sql: 'INSERT OR IGNORE INTO demo_action_counts(module, actions) VALUES(?, 0)', args: [moduleName], wantRows: false },
    { sql: 'UPDATE demo_action_counts SET actions = actions + 1 WHERE module = ? AND actions < ?', args: [moduleName, DEMO_LIMIT], wantRows: false },
  ]);
  return Number(results[1]?.affected_row_count || 0) === 1;
}

/** Returns stable counters even before a category has its first action. */
export async function getDemoActionCounts(): Promise<Record<DemoTrackedModule, number>> {
  const result = await tursoExecute({
    sql: 'SELECT module, actions FROM demo_action_counts WHERE module IN (?, ?, ?)',
    args: [...DEMO_TRACKED_MODULES],
    wantRows: true,
  });
  const counts = Object.fromEntries(DEMO_TRACKED_MODULES.map((name) => [name, 0])) as Record<DemoTrackedModule, number>;
  for (const row of (result.rows || []) as Array<{ module: string; actions: number }>) {
    if (DEMO_TRACKED_MODULES.includes(row.module as DemoTrackedModule)) {
      counts[row.module as DemoTrackedModule] = Math.min(DEMO_LIMIT, Math.max(0, Number(row.actions) || 0));
    }
  }
  return counts;
}

/** Once any one demo allowance is exhausted, all write operations are blocked. */
export async function isDemoExhausted(): Promise<{ exhausted: boolean; module?: DemoTrackedModule; counts: Record<DemoTrackedModule, number> }> {
  const counts = await getDemoActionCounts();
  const module = DEMO_TRACKED_MODULES.find((name) => counts[name] >= DEMO_LIMIT);
  return { exhausted: Boolean(module), module, counts };
}
