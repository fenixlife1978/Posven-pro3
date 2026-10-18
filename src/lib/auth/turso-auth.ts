import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { tursoExecute, tursoTransaction } from '@/lib/turso/client';
import { ensureTursoSchema } from '@/lib/turso/schema-init';

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
  await ensureTursoSchema();
  const value = String(identifier || '').trim().toLowerCase();
  if (!value) return null;
  const result = await tursoExecute({
    sql: `SELECT * FROM users WHERE lower(username)=? OR lower(COALESCE(email,''))=? LIMIT 1`,
    args: [value, value],
  });
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function getUserWithSecret(identifier: string) {
  await ensureTursoSchema();
  const value = String(identifier || '').trim().toLowerCase();
  const result = await tursoExecute({
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
  await ensureTursoSchema();
  const username = input.username.trim().toLowerCase();
  const email = input.email?.trim().toLowerCase() || null;
  if (!username || !input.nombre.trim()) throw new Error('Nombre y usuario son obligatorios.');
  if (!['administrador', 'cajero'].includes(input.rol)) throw new Error('Rol inválido.');

  const existing = await tursoExecute({
    sql: `SELECT id FROM users WHERE lower(username)=? OR (? IS NOT NULL AND lower(email)=?) LIMIT 1`,
    args: [username, email, email],
  });
  if (existing.rows.length) throw new Error('El usuario o correo ya está registrado.');

  const id = newId('usr');
  const fecha = nowIso();
  const passwordHash = hashPassword(input.password);

  await tursoExecute({
    sql: `INSERT INTO users
      (id, username, email, nombre, rol, password_hash, acceso_bloqueado, is_seed_admin, fecha_creacion, data_json)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, '{}')`,
    args: [id, username, email, input.nombre.trim(), input.rol, passwordHash, input.isSeedAdmin ? 1 : 0, fecha],
    wantRows: false,
  });

  return findUser(username);
}

/**
 * Ensure the database is recoverable when it has no active administrator.
 * This is called before credential lookup on login, so first install and a
 * deliberate Turso data reset both bootstrap on the first login attempt.
 * Never create a backdoor seed account while another active administrator exists.
 */
export async function ensureSeedAdmin() {
  await ensureTursoSchema();

  const activeAdmins = await tursoExecute({
    sql: `SELECT id FROM users WHERE rol='administrador' AND acceso_bloqueado=0 LIMIT 1`,
  });
  if (activeAdmins.rows.length) return;

  // The seed account is only reset when no active administrator exists.
  // This repairs stale/incompatible hashes after a reset or failed first setup.
  const seedPassword = process.env.POSVEN_SEED_ADMIN_PASSWORD || 'admin123';
  const existingSeed = await tursoExecute({
    sql: `SELECT id FROM users WHERE lower(username)='admin' LIMIT 1`,
  });

  if (existingSeed.rows.length) {
    await tursoExecute({
      sql: `UPDATE users
        SET rol='administrador', acceso_bloqueado=0, is_seed_admin=1,
            email=COALESCE(email, 'admin@posven.local'),
            nombre=COALESCE(NULLIF(nombre,''),'ADMINISTRADOR'),
            password_hash=?
        WHERE id=?`,
      args: [hashPassword(seedPassword), String(existingSeed.rows[0].id)],
      wantRows: false,
    });
    return;
  }
  try {
    await createUser({
      username: 'admin',
      email: 'admin@posven.local',
      nombre: 'ADMINISTRADOR',
      password: seedPassword,
      rol: 'administrador',
      isSeedAdmin: true,
    });
  } catch (error) {
    // Two first-login requests may race. If the other request created the
    // seed account, treat that as success; otherwise preserve the real error.
    const winner = await tursoExecute({
      sql: `SELECT id FROM users WHERE lower(username)='admin' AND is_seed_admin=1 LIMIT 1`,
    });
    if (!winner.rows.length) throw error;
  }
}

export async function createSession(userId: string) {
  await ensureTursoSchema();
  const id = randomBytes(32).toString('hex');
  const created = nowIso();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await tursoExecute({
    sql: `INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`,
    args: [id, userId, expires, created, created],
    wantRows: false,
  });
  return { id, expires };
}

export async function getSessionUser(sessionId: string | null | undefined) {
  await ensureTursoSchema();
  if (!sessionId) return null;
  const result = await tursoExecute({
    sql: `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
      LIMIT 1`,
    args: [sessionId],
  });
  if (!result.rows[0]) return null;
  const user = mapUser(result.rows[0]);
  if (user.accesoBloqueado) return null;
  await tursoExecute({
    sql: `UPDATE sessions SET last_seen_at=? WHERE id=?`,
    args: [nowIso(), sessionId],
    wantRows: false,
  });
  return user;
}

export async function revokeSession(sessionId: string | null | undefined) {
  await ensureTursoSchema();
  if (!sessionId) return;
  await tursoExecute({
    sql: `UPDATE sessions SET revoked_at=? WHERE id=?`,
    args: [nowIso(), sessionId],
    wantRows: false,
  });
}

export async function listUsers() {
  await ensureTursoSchema();
  const result = await tursoExecute({
    sql: `SELECT id, username, email, nombre, rol, acceso_bloqueado, is_seed_admin, fecha_creacion
      FROM users ORDER BY lower(nombre), lower(username)`,
  });
  return result.rows.map(mapUser);
}

export async function setUserBlocked(id: string, blocked: boolean) {
  await ensureTursoSchema();
  const target = await tursoExecute({
    sql: `SELECT rol, is_seed_admin, acceso_bloqueado FROM users WHERE id=? LIMIT 1`,
    args: [id],
  });
  if (!target.rows[0]) throw new Error('Usuario no encontrado.');

  const wasBlocked = Number(target.rows[0].acceso_bloqueado || 0) === 1;
  if (wasBlocked === blocked) return;

  if (blocked && String(target.rows[0].rol) === 'administrador') {
    const activeAdmins = await tursoExecute({
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

  await tursoTransaction([
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
  await ensureTursoSchema();
  const target = await tursoExecute({
    sql: `SELECT is_seed_admin FROM users WHERE id=? LIMIT 1`,
    args: [id],
  });
  if (!target.rows[0]) throw new Error('Usuario no encontrado.');
  if (Number(target.rows[0].is_seed_admin) === 1) {
    throw new Error('El administrador semilla no puede eliminarse.');
  }
  await tursoTransaction([
    { sql: `DELETE FROM sessions WHERE user_id=?`, args: [id], wantRows: false },
    { sql: `DELETE FROM users WHERE id=?`, args: [id], wantRows: false },
  ]);
}
