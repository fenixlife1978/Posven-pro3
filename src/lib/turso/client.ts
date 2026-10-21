/**
 * Motor SQLite local para la aplicación de escritorio POSVEN-PRO3.
 * Conserva los nombres de exportación históricos para no romper los repositorios
 * de negocio existentes, pero NO realiza conexiones HTTP ni requiere credenciales
 * de nube. La ruta de la base se define en POSVEN_SQLITE_PATH desde Electron.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type TursoStatement = {
  sql: string;
  args?: unknown[];
  wantRows?: boolean;
};

export type TursoTransactionContext = {
  execute: (statement: TursoStatement) => Promise<any>;
};

let database: Database.Database | null = null;
let lockTail: Promise<void> = Promise.resolve();

function withLock<T>(work: () => T | Promise<T>): Promise<T> {
  const run = lockTail.then(work, work);
  lockTail = run.then(() => undefined, () => undefined);
  return run;
}

function getDatabase(): Database.Database {
  if (database) return database;
  const configuredPath = String(process.env.POSVEN_SQLITE_PATH || '').trim();
  const dbPath = configuredPath || path.join(process.cwd(), 'data', 'posven-pro3.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  // FULL sincroniza cada COMMIT con el sistema de archivos para mejorar la
  // recuperación ante corte eléctrico o apagado inesperado.
  database.pragma('synchronous = FULL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 10000');
  return database;
}

/** Siempre disponible: la aplicación trabaja contra SQLite local, no contra nube. */
export function isTursoConfigured(): boolean {
  return true;
}

function executeUnlocked(statement: TursoStatement) {
  const db = getDatabase();
  const prepared = db.prepare(statement.sql);
  const args = (statement.args || []) as any[];
  if (prepared.reader && statement.wantRows !== false) {
    const rows = prepared.all(...args) as Record<string, unknown>[];
    const cols = prepared.columns().map(column => ({ name: column.name, decltype: column.type || null }));
    return { cols, rows, affected_row_count: 0, last_insert_rowid: null };
  }
  const result = prepared.run(...args);
  return {
    cols: [],
    rows: [],
    affected_row_count: result.changes,
    last_insert_rowid: result.lastInsertRowid == null ? null : String(result.lastInsertRowid),
  };
}

export async function tursoExecute(statement: TursoStatement) {
  return withLock(() => executeUnlocked(statement));
}

export async function tursoBatch(statements: TursoStatement[]) {
  if (!statements.length) return [];
  return withLock(() => {
    const db = getDatabase();
    const run = db.transaction(() => statements.map(executeUnlocked));
    return run();
  });
}

export async function tursoTransaction(statements: TursoStatement[]) {
  if (!statements.length) return [];
  return withLock(() => {
    const db = getDatabase();
    const run = db.transaction(() => statements.map(executeUnlocked));
    return run();
  });
}

/**
 * Las transacciones críticas se serializan dentro del proceso local. Mientras
 * dura una transacción, otras lecturas/escrituras esperan para evitar mezclar
 * operaciones de caja entre sí.
 */
export async function tursoInteractiveTransaction<T>(
  callback: (tx: TursoTransactionContext) => Promise<T>,
): Promise<T> {
  return withLock(async () => {
    const db = getDatabase();
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = await callback({ execute: async statement => executeUnlocked(statement) });
      db.exec('COMMIT');
      return value;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  });
}
