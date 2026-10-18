import { tursoBatch, tursoExecute } from '@/lib/turso/client';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS app_config (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT, nombre TEXT NOT NULL, rol TEXT NOT NULL CHECK (rol IN ('administrador','cajero')), password_hash TEXT NOT NULL, acceso_bloqueado INTEGER NOT NULL DEFAULT 0, is_seed_admin INTEGER NOT NULL DEFAULT 0, firebase_uid TEXT, fecha_creacion TEXT, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid) WHERE firebase_uid IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS user_identity_map (source TEXT NOT NULL, legacy_user_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, firebase_uid TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (source, legacy_user_id))`,
  `CREATE INDEX IF NOT EXISTS idx_user_identity_map_user ON user_identity_map(user_id)`,
  `CREATE TABLE IF NOT EXISTS catalogos (nombre TEXT PRIMARY KEY, lista_json TEXT NOT NULL DEFAULT '[]', data_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS productos (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS movimientos (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS ventas (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS cxc (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS cxp (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS clientes (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS proveedores (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS devoluciones (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS anulaciones (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS terminales (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS libro_diario (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS reportes_z (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS caja (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS compras (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS operaciones (id TEXT PRIMARY KEY, prefijo TEXT NOT NULL, operation_id TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(prefijo, operation_id))`,
  `CREATE INDEX IF NOT EXISTS idx_operaciones_created_at ON operaciones(created_at)`,
  `CREATE TABLE IF NOT EXISTS auditoria_sistema (id TEXT PRIMARY KEY, tipo TEXT, terminal_id TEXT, usuario_id TEXT, fecha TEXT, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_auditoria_terminal_fecha ON auditoria_sistema(terminal_id, fecha)`,
  `CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_fecha ON auditoria_sistema(usuario_id, fecha)`,
  `CREATE TABLE IF NOT EXISTS legacy_documents (path TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', present INTEGER NOT NULL DEFAULT 1, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT, revoked_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS migration_runs (id TEXT PRIMARY KEY, source TEXT NOT NULL, backup_version INTEGER, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, counts_json TEXT NOT NULL DEFAULT '{}', notes TEXT)`,
];

let initialized = false;
let initializing: Promise<void> | null = null;

async function initialize() {
  const probe = await tursoExecute({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='users' LIMIT 1" });
  if (probe.rows.length) {
    initialized = true;
    return;
  }

  await tursoBatch(SCHEMA_STATEMENTS.map(sql => ({ sql, wantRows: false })));

  const verify = await tursoExecute({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','terminales','ventas','caja') ORDER BY name" });
  const names = new Set(verify.rows.map((row: any) => String(row.name)));
  for (const required of ['users', 'sessions', 'terminales', 'ventas', 'caja']) {
    if (!names.has(required)) throw new Error(`La inicialización de Turso no creó la tabla requerida: ${required}`);
  }
  initialized = true;
}

export async function ensureTursoSchema() {
  if (initialized) return;
  if (!initializing) {
    initializing = initialize().finally(() => {
      initializing = null;
    });
  }
  await initializing;
}
