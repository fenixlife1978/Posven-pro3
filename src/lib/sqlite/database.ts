import path from 'node:path';
import fs from 'node:fs';

type SqliteDatabase = any;
const globalKey = '__POSVEN_SQLITE_DATABASE__';

function resolveDatabasePath() {
  const configured = String(process.env.POSVEN_SQLITE_PATH || '').trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), '.posven-data', 'posven-pro3.sqlite');
}

export function getSqliteDatabase(): SqliteDatabase {
  const root = globalThis as typeof globalThis & { [globalKey]?: SqliteDatabase };
  if (root[globalKey]) return root[globalKey];

  // better-sqlite3 is a native dependency and is externalized by Next.js.
  // It is loaded only by the Node.js server runtime, never by the browser.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  const filename = resolveDatabasePath();
  fs.mkdirSync(path.dirname(filename), { recursive: true });

  const db = new BetterSqlite3(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000');
  db.pragma('temp_store = MEMORY');

  root[globalKey] = db;
  return db;
}

export function getSqliteDatabasePath() {
  return resolveDatabasePath();
}

export function closeSqliteDatabase() {
  const root = globalThis as typeof globalThis & { [globalKey]?: SqliteDatabase };
  const db = root[globalKey];
  if (db?.open) db.close();
  delete root[globalKey];
}

export async function createSqliteBackup(destination: string) {
  const db = getSqliteDatabase();
  const target = path.resolve(destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await db.backup(target);
  return target;
}

export function sqliteHealthCheck() {
  const db = getSqliteDatabase();
  // Health polling runs from every client every few seconds. Keep this probe
  // constant-time; full integrity_check is reserved for backup restoration.
  const probe = db.prepare('SELECT 1 AS ok').get();
  return {
    ok: Number(probe?.ok) === 1,
    journalMode: db.pragma('journal_mode', { simple: true }),
    foreignKeys: db.pragma('foreign_keys', { simple: true }),
    databasePath: resolveDatabasePath(),
  };
}
