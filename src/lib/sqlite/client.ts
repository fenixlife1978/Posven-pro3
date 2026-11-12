import { getSqliteDatabase, getSqliteDatabasePath } from './database';

export type SQLiteStatement = {
  sql: string;
  args?: unknown[];
  wantRows?: boolean;
};

export type SQLiteResult = {
  rows: Record<string, any>[];
  affected_row_count: number;
  last_insert_rowid: string | null;
};

// better-sqlite3 is synchronous. This async mutex is essential because the
// existing business services use async interactive transaction callbacks.
// It prevents another HTTP request from entering the same connection while a
// transaction callback is awaiting its next statement.
type LockState = { tail: Promise<void> };

function getLockState(): LockState {
  const root = globalThis as typeof globalThis & { __POSVEN_SQLITE_LOCK_STATE__?: LockState };
  if (!root.__POSVEN_SQLITE_LOCK_STATE__) root.__POSVEN_SQLITE_LOCK_STATE__ = { tail: Promise.resolve() };
  return root.__POSVEN_SQLITE_LOCK_STATE__;
}

async function withDatabaseLock<T>(work: () => T | Promise<T>): Promise<T> {
  const state = getLockState();
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

function executeDirect(statement: SQLiteStatement): SQLiteResult {
  const db = getSqliteDatabase();
  const prepared = db.prepare(statement.sql);
  const args = Array.isArray(statement.args) ? statement.args : [];

  if (prepared.reader && statement.wantRows !== false) {
    const rows = prepared.all(...args);
    return { rows, affected_row_count: 0, last_insert_rowid: null };
  }

  const result = prepared.run(...args);
  return {
    rows: [],
    affected_row_count: Number(result.changes || 0),
    last_insert_rowid: result.lastInsertRowid == null ? null : String(result.lastInsertRowid),
  };
}

export function isSQLiteConfigured() {
  try {
    getSqliteDatabasePath();
    return true;
  } catch {
    return false;
  }
}

export function assertSQLiteReady() {
  getSqliteDatabase();
}

export async function sqliteExecute(statement: SQLiteStatement): Promise<SQLiteResult> {
  return withDatabaseLock(() => executeDirect(statement));
}

export async function sqliteBatch(statements: SQLiteStatement[]) {
  if (!statements.length) return [];
  return withDatabaseLock(() => {
    const db = getSqliteDatabase();
    const run = db.transaction(() => statements.map(executeDirect));
    return run();
  });
}

export async function sqliteTransaction(statements: SQLiteStatement[]) {
  return sqliteBatch(statements);
}

export type SQLiteTransactionContext = {
  execute: (statement: SQLiteStatement) => Promise<SQLiteResult>;
};

export async function sqliteInteractiveTransaction<T>(
  callback: (tx: SQLiteTransactionContext) => Promise<T>,
): Promise<T> {
  return withDatabaseLock(async () => {
    const db = getSqliteDatabase();
    db.exec('BEGIN IMMEDIATE');
    let active = true;
    const tx: SQLiteTransactionContext = {
      execute: async (statement) => {
        if (!active) throw new Error('La transacción SQLite ya fue cerrada.');
        return executeDirect(statement);
      },
    };

    try {
      const value = await callback(tx);
      db.exec('COMMIT');
      active = false;
      return value;
    } catch (error) {
      if (active) {
        try { db.exec('ROLLBACK'); } catch {}
        active = false;
      }
      throw error;
    }
  });
}
