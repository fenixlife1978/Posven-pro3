/**
 * Adaptador SQLite local para POSVEN-PRO3.
 * No realiza peticiones HTTP ni usa credenciales cloud.
 * Requiere Electron/Node 22+ por node:sqlite.
 */
import fs from 'node:fs';
import path from 'node:path';

type SqliteStatement = { sql: string; args?: unknown[]; wantRows?: boolean };
export type TursoStatement = SqliteStatement;
type SqliteRunResult = { changes: number; lastInsertRowid: number | bigint };
type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...args: any[]): Record<string, unknown>[];
    get(...args: any[]): Record<string, unknown> | undefined;
    run(...args: any[]): SqliteRunResult;
  };
  close(): void;
};

let database: SqliteDatabase | null = null;
let transactionActive = false;

function getDatabase(): SqliteDatabase {
  if (database) return database;
  const filename = String(process.env.POSVEN_SQLITE_PATH || '').trim();
  if (!filename) throw new Error('SQLite local no está inicializado. Inicia POSVEN-PRO3 desde su aplicación de escritorio.');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  // node:sqlite es parte del runtime de Node 22 incluido en Electron 38.
  const { DatabaseSync } = require('node:sqlite');
  database = new DatabaseSync(filename) as SqliteDatabase;
  database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
  return database;
}

function run(statement: SqliteStatement) {
  const db = getDatabase();
  const prepared = db.prepare(statement.sql);
  if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(statement.sql)) {
    const rows = prepared.all(...(statement.args || []));
    return { rows, affected_row_count: 0, last_insert_rowid: null };
  }
  const result = prepared.run(...(statement.args || []));
  return { rows: [], affected_row_count: Number(result.changes || 0), last_insert_rowid: String(result.lastInsertRowid ?? '') };
}

export function isTursoConfigured(): boolean {
  // Nombre histórico para compatibilidad interna; verifica SQLite local.
  return Boolean(String(process.env.POSVEN_SQLITE_PATH || '').trim());
}

export async function tursoExecute(statement: TursoStatement) {
  return run(statement);
}

export async function tursoBatch(statements: TursoStatement[]) {
  if (!statements.length) return [];
  return tursoTransaction(statements);
}

export async function tursoTransaction(statements: TursoStatement[]) {
  if (!statements.length) return [];
  const db = getDatabase();
  if (transactionActive) throw new Error('No se permite una transacción SQLite anidada.');
  transactionActive = true;
  db.exec('BEGIN IMMEDIATE');
  try {
    const outputs = statements.map(run);
    db.exec('COMMIT');
    return outputs;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    transactionActive = false;
  }
}

export type TursoTransactionContext = {
  execute: (statement: TursoStatement) => Promise<any>;
};

export async function tursoInteractiveTransaction<T>(
  callback: (tx: TursoTransactionContext) => Promise<T>,
): Promise<T> {
  const db = getDatabase();
  if (transactionActive) throw new Error('No se permite una transacción SQLite anidada.');
  transactionActive = true;
  db.exec('BEGIN IMMEDIATE');
  const execute = async (statement: TursoStatement) => run(statement);
  try {
    const value = await callback({ execute });
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    transactionActive = false;
  }
}
