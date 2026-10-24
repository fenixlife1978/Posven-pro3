import { tursoTransaction } from '@/lib/turso/client';

/** Atomically consumes one of the ten allowed demo actions for a module. */
export async function reserveDemoAction(moduleName: string): Promise<boolean> {
  const results = await tursoTransaction([
    { sql: 'INSERT OR IGNORE INTO demo_action_counts(module, actions) VALUES(?, 0)', args: [moduleName], wantRows: false },
    { sql: 'UPDATE demo_action_counts SET actions = actions + 1 WHERE module = ? AND actions < 10', args: [moduleName], wantRows: false },
  ]);
  return Number(results[1]?.affected_row_count || 0) === 1;
}
