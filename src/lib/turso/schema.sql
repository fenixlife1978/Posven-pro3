-- POSVEN PRO / Turso (SQLite/libSQL)
-- Esquema base de migración desde Firestore/RTDB.
-- Regla: conservar siempre el ID original de Firestore y el payload JSON completo.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_config (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('administrador','cajero')),
  password_hash TEXT NOT NULL,
  acceso_bloqueado INTEGER NOT NULL DEFAULT 0,
  is_seed_admin INTEGER NOT NULL DEFAULT 0,
  firebase_uid TEXT,
  fecha_creacion TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid) WHERE firebase_uid IS NOT NULL;

-- Para usuarios migrados desde Firebase, id = firebase UID siempre que no exista conflicto.
-- Así terminales, ventas y demás históricos que ya guardan ese UID continúan
-- apuntando al mismo usuario sin reescribir registros históricos.
CREATE TABLE IF NOT EXISTS user_identity_map (
  source TEXT NOT NULL,
  legacy_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  firebase_uid TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source, legacy_user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_identity_map_user ON user_identity_map(user_id);

-- El administrador semilla se crea también por código de inicialización/reset.
-- La contraseña se almacena como hash, nunca como texto plano.

CREATE TABLE IF NOT EXISTS catalogos (
  nombre TEXT PRIMARY KEY,
  lista_json TEXT NOT NULL DEFAULT '[]',
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS productos (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS movimientos (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ventas (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cxc (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cxp (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proveedores (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devoluciones (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS anulaciones (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS terminales (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS libro_diario (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reportes_z (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS caja (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compras (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  fecha TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotencia: reemplaza la colección Firestore "operaciones".
CREATE TABLE IF NOT EXISTS operaciones (
  id TEXT PRIMARY KEY,
  prefijo TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(prefijo, operation_id)
);
CREATE INDEX IF NOT EXISTS idx_operaciones_created_at ON operaciones(created_at);

-- Auditoría de recuperación/interrupciones y futuras acciones administrativas.
CREATE TABLE IF NOT EXISTS auditoria_sistema (
  id TEXT PRIMARY KEY,
  tipo TEXT,
  terminal_id TEXT,
  usuario_id TEXT,
  fecha TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auditoria_terminal_fecha ON auditoria_sistema(terminal_id, fecha);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_fecha ON auditoria_sistema(usuario_id, fecha);

-- Documentos legacy que existan en Firestore y no formen parte del flujo actual.
CREATE TABLE IF NOT EXISTS legacy_documents (
  path TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  present INTEGER NOT NULL DEFAULT 1,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Sesiones propias de POSVEN; no depende de Firebase Authentication.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Registro de migración para poder verificar conteos y repetir pasos de forma segura.
CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  backup_version INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  counts_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT
);
