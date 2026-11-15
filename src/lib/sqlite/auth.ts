import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { sqliteExecute, sqliteTransaction, sqliteInteractiveTransaction } from '@/lib/sqlite/client';
import { ensureSqliteSchema } from '@/lib/sqlite/schema-init';

export type AppRole = 'administrador' | 'cajero';

export type AuthUser = {
  id: string;
  username: string;
  email: string | null;
  nombre: string;
  rol: AppRole;
  accesoBloqueado: boolean;
  isSeedAdmin: boolean;
  fechaCreacion: string | null;
};

const SESSION_DAYS = 7;

export function getRequestSessionId(request: Request) {
  const mode = request.headers.get('x-posven-session-mode');
  const tabSessionId = request.headers.get('x-posven-session')?.trim();
  if (mode === 'tab') return tabSessionId || null;

  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)posven_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return prefix + '_' + randomBytes(18).toString('hex');
}

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  if (!password || password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const derived = scryptSync(password, parts[1], 64);
  const expected = Buffer.from(parts[2], 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function mapUser(row: any): AuthUser {
  return {
    id: String(row.id),
    username: String(row.username),
    email: row.email == null ? null : String(row.email),
    nombre: String(row.nombre || ''),
    rol: String(row.rol) as AppRole,
    accesoBloqueado: Number(row.acceso_bloqueado || 0) === 1,
    isSeedAdmin: Number(row.is_seed_admin || 0) === 1,
    fechaCreacion: row.fecha_creacion == null ? null : String(row.fecha_creacion),
  };
}

export async function findUser(identifier: string) {
  await ensureSqliteSchema();
  const value = String(identifier || '').trim().toLowerCase();
  if (!value) return null;
  const result = await sqliteExecute({
    sql: `SELECT * FROM users WHERE lower(username)=? OR lower(COALESCE(email,''))=? LIMIT 1`,
    args: [value, value],
  });
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function getUserWithSecret(identifier: string) {
  await ensureSqliteSchema();
  const value = String(identifier || '').trim().toLowerCase();
  const result = await sqliteExecute({
    sql: `SELECT * FROM users WHERE lower(username)=? OR lower(COALESCE(email,''))=? LIMIT 1`,
    args: [value, value],
  });
  return result.rows[0] || null;
}

export async function createUser(input: {
  username: string;
  email?: string;
  nombre: string;
  password: string;
  rol: AppRole;
  isSeedAdmin?: boolean;
}) {
  await ensureSqliteSchema();
  const username = input.username.trim().toLowerCase();
  const email = input.email?.trim().toLowerCase() || null;
  if (!username || !input.nombre.trim()) throw new Error('Nombre y usuario son obligatorios.');
  if (!['administrador', 'cajero'].includes(input.rol)) throw new Error('Rol inválido.');

  const existing = await sqliteExecute({
    sql: `SELECT id FROM users WHERE lower(username)=? OR (? IS NOT NULL AND lower(email)=?) LIMIT 1`,
    args: [username, email, email],
  });
  if (existing.rows.length) throw new Error('El usuario o correo ya está registrado.');

  const id = newId('usr');
  const fecha = nowIso();
  const passwordHash = hashPassword(input.password);

  await sqliteExecute({
    sql: `INSERT INTO users
      (id, username, email, nombre, rol, password_hash, acceso_bloqueado, is_seed_admin, fecha_creacion, data_json)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, '{}')`,
    args: [id, username, email, input.nombre.trim(), input.rol, passwordHash, input.isSeedAdmin ? 1 : 0, fecha],
    wantRows: false,
  });

  return findUser(username);
}


/** True only while this SQLite database has never had an administrator. */
export async function needsFirstAdministrator() {
  await ensureSqliteSchema();
  const result = await sqliteExecute({
    sql: `SELECT COUNT(*) AS total FROM users WHERE rol='administrador'`,
  });
  return Number(result.rows[0]?.total || 0) === 0;
}

/**
 * Create the initial administrator exactly once. BEGIN IMMEDIATE serializes
 * simultaneous setup requests; the second request observes the first admin
 * and is rejected. This endpoint is not a general user-creation mechanism.
 */
export async function createFirstAdministrator(input: {
  username: string;
  email: string;
  nombre: string;
  password: string;
}) {
  await ensureSqliteSchema();
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  const nombre = input.nombre.trim();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error('El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.');
  }
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    throw new Error('Ingrese un correo electrónico válido.');
  }
  if (nombre.length < 2 || nombre.length > 80) throw new Error('Ingrese el nombre del administrador.');
  if (input.password.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres.');
  const passwordHash = hashPassword(input.password);
  const id = newId('usr');
  const fecha = nowIso();

  return sqliteInteractiveTransaction(async tx => {
    const admins = await tx.execute({
      sql: `SELECT id FROM users WHERE rol='administrador' LIMIT 1`,
    });
    if (admins.rows.length) {
      throw new Error('El administrador inicial ya fue configurado. Inicie sesión normalmente.');
    }
    await tx.execute({
      sql: `INSERT INTO users
        (id, username, email, nombre, rol, password_hash, acceso_bloqueado, is_seed_admin, fecha_creacion, data_json)
        VALUES (?, ?, ?, ?, 'administrador', ?, 0, 0, ?, '{}')`,
      args: [id, username, email, nombre, passwordHash, fecha],
      wantRows: false,
    });
    return mapUser({
      id, username, email, nombre, rol: 'administrador',
      acceso_bloqueado: 0, is_seed_admin: 0, fecha_creacion: fecha,
    });
  });
}


const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

function loginAttemptKeys(identifier: string, origin: string) {
  const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
  const normalizedOrigin = isIP(String(origin || '').trim())
    ? String(origin).trim().toLowerCase()
    : 'unknown';
  return {
    identifierKey: createHash('sha256').update(normalizedIdentifier).digest('hex'),
    originKey: createHash('sha256').update(normalizedOrigin).digest('hex'),
  };
}

/**
 * Consume one login attempt atomically before password verification.
 * Limits are scoped to the identifier + source address pair so several cash
 * terminals behind the same LAN/NAT address do not block one another.
 * Only hashes are persisted; passwords, raw identifiers and IP addresses are
 * never stored in auth_login_attempts.
 */
export async function consumeLoginAttempt(identifier: string, origin: string, now = new Date()) {
  await ensureSqliteSchema();
  const { identifierKey, originKey } = loginAttemptKeys(identifier, origin);
  const nowIsoValue = now.toISOString();
  const retentionCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  return sqliteInteractiveTransaction(async tx => {
    await tx.execute({
      sql: 'DELETE FROM auth_login_attempts WHERE updated_at < ? AND (locked_until IS NULL OR locked_until <= ?)',
      args: [retentionCutoff, nowIsoValue],
      wantRows: false,
    });

    const found = await tx.execute({
      sql: 'SELECT window_started_at, attempt_count, locked_until FROM auth_login_attempts WHERE identifier_key=? AND origin_key=? LIMIT 1',
      args: [identifierKey, originKey],
    });
    const row = found.rows[0];

    if (row?.locked_until && Date.parse(String(row.locked_until)) > now.getTime()) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(String(row.locked_until)) - now.getTime()) / 1000)),
      };
    }

    const windowStarted = row ? Date.parse(String(row.window_started_at)) : NaN;
    const windowExpired = !Number.isFinite(windowStarted) || now.getTime() - windowStarted >= LOGIN_WINDOW_MS;
    const previousCount = row && !windowExpired ? Number(row.attempt_count || 0) : 0;
    if (previousCount >= LOGIN_ATTEMPT_LIMIT) {
      const lockedUntil = new Date(now.getTime() + LOGIN_LOCKOUT_MS).toISOString();
      await tx.execute({
        sql: 'UPDATE auth_login_attempts SET locked_until=?, updated_at=? WHERE identifier_key=? AND origin_key=?',
        args: [lockedUntil, nowIsoValue, identifierKey, originKey],
        wantRows: false,
      });
      return { allowed: false, retryAfterSeconds: Math.ceil(LOGIN_LOCKOUT_MS / 1000) };
    }

    const nextCount = previousCount + 1;
    const nextWindowStarted = windowExpired ? nowIsoValue : String(row.window_started_at);
    const lockedUntil = nextCount >= LOGIN_ATTEMPT_LIMIT
      ? new Date(now.getTime() + LOGIN_LOCKOUT_MS).toISOString()
      : null;

    await tx.execute({
      sql: 'INSERT INTO auth_login_attempts (identifier_key, origin_key, window_started_at, attempt_count, locked_until, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(identifier_key, origin_key) DO UPDATE SET ' +
        'window_started_at=excluded.window_started_at, attempt_count=excluded.attempt_count, ' +
        'locked_until=excluded.locked_until, updated_at=excluded.updated_at',
      args: [identifierKey, originKey, nextWindowStarted, nextCount, lockedUntil, nowIsoValue],
      wantRows: false,
    });

    return { allowed: true, retryAfterSeconds: 0 };
  });
}

export async function clearLoginAttempts(identifier: string, origin: string) {
  await ensureSqliteSchema();
  const { identifierKey, originKey } = loginAttemptKeys(identifier, origin);
  await sqliteExecute({
    sql: 'DELETE FROM auth_login_attempts WHERE identifier_key=? AND origin_key=?',
    args: [identifierKey, originKey],
    wantRows: false,
  });
}

export async function createSession(userId: string) {
  await ensureSqliteSchema();
  const id = randomBytes(32).toString('hex');
  const created = nowIso();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await sqliteExecute({
    sql: `INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`,
    args: [id, userId, expires, created, created],
    wantRows: false,
  });
  return { id, expires };
}

export async function getSessionUser(sessionId: string | null | undefined) {
  await ensureSqliteSchema();
  if (!sessionId) return null;
  const result = await sqliteExecute({
    sql: `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at > ?
      LIMIT 1`,
    args: [sessionId, nowIso()],
  });
  if (!result.rows[0]) return null;
  const user = mapUser(result.rows[0]);
  if (user.accesoBloqueado) return null;
  const touchBefore = new Date(Date.now() - 30000).toISOString();
  await sqliteExecute({
    sql: `UPDATE sessions SET last_seen_at=? WHERE id=? AND (last_seen_at IS NULL OR last_seen_at < ?)`,
    args: [nowIso(), sessionId, touchBefore],
    wantRows: false,
  });
  return user;
}

export async function revokeSession(sessionId: string | null | undefined) {
  await ensureSqliteSchema();
  if (!sessionId) return;
  await sqliteExecute({
    sql: `UPDATE sessions SET revoked_at=? WHERE id=?`,
    args: [nowIso(), sessionId],
    wantRows: false,
  });
}


export async function listUsers() {
  await ensureSqliteSchema();
  const result = await sqliteExecute({
    sql: `SELECT id, username, email, nombre, rol, acceso_bloqueado, is_seed_admin, fecha_creacion
      FROM users ORDER BY lower(nombre), lower(username)`,
  });
  return result.rows.map(mapUser);
}

export async function setUserBlocked(id: string, blocked: boolean) {
  await ensureSqliteSchema();
  const target = await sqliteExecute({
    sql: `SELECT rol, is_seed_admin, acceso_bloqueado FROM users WHERE id=? LIMIT 1`,
    args: [id],
  });
  if (!target.rows[0]) throw new Error('Usuario no encontrado.');

  const wasBlocked = Number(target.rows[0].acceso_bloqueado || 0) === 1;
  if (wasBlocked === blocked) return;

  if (blocked && String(target.rows[0].rol) === 'administrador') {
    const activeAdmins = await sqliteExecute({
      sql: `SELECT COUNT(*) AS total FROM users
        WHERE rol='administrador' AND acceso_bloqueado=0 AND id<>?`,
      args: [id],
    });
    const total = Number(activeAdmins.rows[0]?.total || 0);
    if (total < 1) {
      if (Number(target.rows[0].is_seed_admin || 0) === 1) {
        throw new Error('Primero debe crear y activar otro administrador antes de desactivar el administrador semilla.');
      }
      throw new Error('No se puede desactivar al último administrador activo del sistema.');
    }
  }

  await sqliteTransaction([
    {
      sql: `UPDATE users SET acceso_bloqueado=? WHERE id=?`,
      args: [blocked ? 1 : 0, id],
      wantRows: false,
    },
    ...(blocked
      ? [{ sql: `UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`, args: [nowIso(), id], wantRows: false }]
      : []),
  ]);
}

export async function deleteUser(id: string) {
  await ensureSqliteSchema();
  const target = await sqliteExecute({
    sql: `SELECT is_seed_admin FROM users WHERE id=? LIMIT 1`,
    args: [id],
  });
  if (!target.rows[0]) throw new Error('Usuario no encontrado.');
  if (Number(target.rows[0].is_seed_admin) === 1) {
    throw new Error('El administrador semilla no puede eliminarse.');
  }
  await sqliteTransaction([
    { sql: `DELETE FROM sessions WHERE user_id=?`, args: [id], wantRows: false },
    { sql: `DELETE FROM users WHERE id=?`, args: [id], wantRows: false },
  ]);
}
