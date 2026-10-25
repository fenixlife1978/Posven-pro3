import { tursoTransaction, tursoExecute } from '@/lib/turso/client';

export const DEMO_LIMIT = 10;
export const DEMO_TRACKED_MODULES = ['Ventas', 'Productos creados', 'Compras'] as const;
export type DemoTrackedModule = typeof DEMO_TRACKED_MODULES[number];
const ENSURE_DEMO_SCHEMA = "CREATE TABLE IF NOT EXISTS demo_action_counts (module TEXT PRIMARY KEY NOT NULL, actions INTEGER NOT NULL DEFAULT 0 CHECK(actions >= 0))";

async function ensureDemoSchema(): Promise<void> {
  await tursoExecute({ sql: ENSURE_DEMO_SCHEMA, wantRows: false });
}


/** Atomically consumes one of the ten allowed demo actions for a tracked category. */
export async function reserveDemoAction(moduleName: string): Promise<boolean> {
  if (!DEMO_TRACKED_MODULES.includes(moduleName as DemoTrackedModule)) return false;
  await ensureDemoSchema();
  // Seed all counters and check the global lock in the SAME SQLite transaction
  // as the increment. Concurrent requests cannot slip through after another
  // category reaches 10/10.
  const statements = [
    ...DEMO_TRACKED_MODULES.map((name) => ({
      sql: 'INSERT OR IGNORE INTO demo_action_counts(module, actions) VALUES(?, 0)',
      args: [name],
      wantRows: false,
    })),
    {
      sql: 'UPDATE demo_action_counts SET actions = actions + 1 WHERE module = ? AND actions < ? AND NOT EXISTS (SELECT 1 FROM demo_action_counts WHERE actions >= ?)',
      args: [moduleName, DEMO_LIMIT, DEMO_LIMIT],
      wantRows: false,
    },
  ];
  const results = await tursoTransaction(statements);
  return Number(results[results.length - 1]?.affected_row_count || 0) === 1;
}

/** Returns stable counters even before a category has its first action. */
export async function getDemoActionCounts(): Promise<Record<DemoTrackedModule, number>> {
  await ensureDemoSchema();
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
