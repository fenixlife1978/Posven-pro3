/**
 * Cliente Turso serverless para POSVEN PRO.
 *
 * Usa SQL sobre HTTP v3 directamente con fetch(), sin agregar dependencias.
 * No se activa automáticamente ni toca Firebase.
 *
 * Solo debe importarse desde código servidor/API.
 */
type TursoValue =
  | { type: 'null'; value: null }
  | { type: 'integer'; value: string }
  | { type: 'float'; value: number }
  | { type: 'text'; value: string }
  | { type: 'blob'; base64: string };

export type TursoStatement = {
  sql: string;
  args?: unknown[];
  wantRows?: boolean;
};

type TursoResult = {
  cols: Array<{ name: string | null; decltype?: string | null }>;
  rows: TursoValue[][];
  affected_row_count?: number;
  last_insert_rowid?: string | null;
};

type TursoResponse = {
  baton: string | null;
  base_url: string | null;
  results: Array<
    | { type: 'ok'; response: { type: string; result?: TursoResult } }
    | { type: 'error'; error: { message: string; code?: string | null } }
  >;
};

function getConfig() {
  let url = String(process.env.TURSO_DATABASE_URL || '').trim().replace(/\/$/, '');
  // Turso suele entregar URLs `libsql://...`; el cliente HTTP nativo de Node
  // no entiende ese esquema. Para el endpoint SQL sobre HTTP debemos usar HTTPS.
  if (url.startsWith('libsql://')) url = 'https://' + url.slice('libsql://'.length);
  const token = String(process.env.TURSO_AUTH_TOKEN || '').trim();
  return { url, token };
}

export function isTursoConfigured(): boolean {
  const { url, token } = getConfig();
  return !!url && !!token;
}

function encodeValue(value: unknown): TursoValue {
  if (value === null || value === undefined) return { type: 'null', value: null };
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { type: 'null', value: null };
    if (Number.isInteger(value)) return { type: 'integer', value: String(value) };
    return { type: 'float', value };
  }
  if (value instanceof Uint8Array) {
    return { type: 'blob', base64: Buffer.from(value).toString('base64') };
  }
  return { type: 'text', value: String(value) };
}

function decodeValue(value: TursoValue): unknown {
  switch (value.type) {
    case 'null': return null;
    case 'integer': {
      const n = Number(value.value);
      return Number.isSafeInteger(n) ? n : BigInt(value.value);
    }
    case 'float': return value.value;
    case 'blob': return Buffer.from(value.base64, 'base64');
    case 'text':
    default: return value.value;
  }
}

function rowsToObjects(result: TursoResult): Record<string, unknown>[] {
  return result.rows.map(row => {
    const out: Record<string, unknown> = {};
    result.cols.forEach((col, index) => {
      out[String(col.name ?? index)] = decodeValue(row[index]);
    });
    return out;
  });
}

async function pipeline(requests: unknown[], baton: string | null = null): Promise<TursoResponse> {
  const { url, token } = getConfig();
  if (!url || !token) {
    throw new Error('Turso no está configurado: faltan TURSO_DATABASE_URL y/o TURSO_AUTH_TOKEN.');
  }

  const response = await fetch(url + '/v3/pipeline', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ baton, requests }),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      'Turso HTTP ' + response.status + ': ' +
      (payload?.error?.message || response.statusText || 'respuesta no válida')
    );
  }
  return payload as TursoResponse;
}

function resultFromItem(item: TursoResponse['results'][number]) {
  if (item.type === 'error') throw new Error(item.error.message);
  const result = item.response.result || { cols: [], rows: [] };
  return { ...result, rows: rowsToObjects(result) };
}

function statementRequest(statement: TursoStatement) {
  return {
    type: 'execute',
    stmt: {
      sql: statement.sql,
      args: (statement.args || []).map(encodeValue),
      want_rows: statement.wantRows !== false,
    },
  };
}

export async function tursoExecute(statement: TursoStatement) {
  const response = await pipeline([statementRequest(statement)]);
  return resultFromItem(response.results[0]);
}

export async function tursoBatch(statements: TursoStatement[]) {
  if (!statements.length) return [];

  const response = await pipeline([{
    type: 'batch',
    batch: {
      steps: statements.map(statement => ({
        stmt: statementRequest(statement).stmt,
      })),
    },
  }]);

  const first = response.results[0];
  if (!first || first.type === 'error') {
    throw new Error(first?.error?.message || 'Turso no pudo ejecutar el lote.');
  }

  const batchResult = first.response.result as any;
  const results = Array.isArray(batchResult?.results) ? batchResult.results : [];
  return results.map((item: TursoResult) => ({
    ...item,
    rows: rowsToObjects(item),
  }));
}

/**
 * Transacción HTTP real en un stream:
 * BEGIN IMMEDIATE -> sentencias -> COMMIT.
 * Si alguna falla, se hace ROLLBACK usando el baton del mismo stream.
 */
export async function tursoTransaction(statements: TursoStatement[]) {
  if (!statements.length) return [];

  let response = await pipeline([
    { type: 'execute', stmt: { sql: 'BEGIN IMMEDIATE', want_rows: false } },
  ]);

  let baton = response.baton;
  if (!baton) throw new Error('Turso cerró el stream al iniciar la transacción.');

  const outputs: TursoResult[] = [];

  try {
    for (const statement of statements) {
      response = await pipeline([statementRequest(statement)], baton);
      baton = response.baton;

      const item = response.results[0];
      if (!item || item.type === 'error') {
        throw new Error(item?.error?.message || 'Turso rechazó una sentencia de la transacción.');
      }

      outputs.push(item.response.result || { cols: [], rows: [] });
      if (!baton) throw new Error('Turso cerró el stream durante la transacción.');
    }

    response = await pipeline([
      { type: 'execute', stmt: { sql: 'COMMIT', want_rows: false } },
      { type: 'close' },
    ], baton);

    const commit = response.results[0];
    if (!commit || commit.type === 'error') {
      throw new Error(commit?.error?.message || 'Turso no pudo confirmar la transacción.');
    }

    return outputs.map(result => ({ ...result, rows: rowsToObjects(result) }));
  } catch (error) {
    if (baton) {
      try {
        await pipeline([
          { type: 'execute', stmt: { sql: 'ROLLBACK', want_rows: false } },
          { type: 'close' },
        ], baton);
      } catch {}
    }
    throw error;
  }
}


export type TursoTransactionContext = {
  execute: (statement: TursoStatement) => Promise<any>;
};

/**
 * Transacción interactiva: permite leer datos dentro de BEGIN IMMEDIATE,
 * calcular el siguiente estado y escribirlo antes de COMMIT. Es la pieza
 * necesaria para conservar las garantías de concurrencia que tenía Firestore
 * runTransaction().
 */
export async function tursoInteractiveTransaction<T>(
  callback: (tx: TursoTransactionContext) => Promise<T>,
): Promise<T> {
  if (!isTursoConfigured()) {
    throw new Error('Turso no está configurado: faltan TURSO_DATABASE_URL y/o TURSO_AUTH_TOKEN.');
  }

  let response = await pipeline([
    { type: 'execute', stmt: { sql: 'BEGIN IMMEDIATE', want_rows: false } },
  ]);
  let baton = response.baton;
  if (!baton) throw new Error('Turso cerró el stream al iniciar la transacción.');

  const execute = async (statement: TursoStatement) => {
    if (!baton) throw new Error('La transacción Turso ya fue cerrada.');
    response = await pipeline([statementRequest(statement)], baton);
    baton = response.baton;
    const item = response.results[0];
    if (!item || item.type === 'error') {
      throw new Error(item?.error?.message || 'Turso rechazó una sentencia de la transacción.');
    }
    return resultFromItem(item);
  };

  try {
    const value = await callback({ execute });
    if (!baton) throw new Error('Turso cerró el stream antes del COMMIT.');
    response = await pipeline([
      { type: 'execute', stmt: { sql: 'COMMIT', want_rows: false } },
      { type: 'close' },
    ], baton);
    const commit = response.results[0];
    if (!commit || commit.type === 'error') {
      throw new Error(commit?.error?.message || 'Turso no pudo confirmar la transacción.');
    }
    baton = null;
    return value;
  } catch (error) {
    if (baton) {
      try {
        await pipeline([
          { type: 'execute', stmt: { sql: 'ROLLBACK', want_rows: false } },
          { type: 'close' },
        ], baton);
      } catch {}
    }
    throw error;
  }
}
