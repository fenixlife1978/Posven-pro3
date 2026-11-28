'use strict';

const http = require('http');

let application = null;
let server = null;
let stopping = false;

async function start() {
  const nextDir = process.env.POSVEN_NEXT_DIR;
  const sqlitePath = process.env.POSVEN_SQLITE_PATH;
  if (!nextDir || !sqlitePath) throw new Error('Faltan las rutas de inicio del servidor POSVEN3.');

  // Importaciones de Next.js, rutas API y better-sqlite3 ocurren exclusivamente
  // en este proceso utility, nunca en el hilo principal de Electron.
  const next = require('next');
  application = next({ dev: false, dir: nextDir });
  await application.prepare();

  // Comprobación temprana del módulo nativo. Next.js lo carga recién en la
  // primera ruta API; si el paquete trae un binario compilado para otro ABI,
  // la interfaz se ve pero el login nunca responde. Fallar aquí deja el motivo
  // real en el registro de arranque en lugar de una pantalla sin explicación.
  try {
    require('better-sqlite3');
  } catch (error) {
    throw new Error('El controlador SQLite no puede cargarse en este proceso: ' + (error?.message || String(error)));
  }

  const handler = application.getRequestHandler();

  server = http.createServer((request, response) => {
    if (stopping) {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Connection': 'close', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: false, error: 'El servidor POSVEN3 está cerrando.' }));
      return;
    }
    Promise.resolve(handler(request, response)).catch(error => {
      console.error('[POSVEN3 worker] Error Next.js:', error);
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: false, error: 'Error interno del servidor POSVEN3.' }));
      } else if (!response.destroyed) response.destroy(error);
    });
  });
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 15000;
  server.requestTimeout = 15 * 60 * 1000;
  server.timeout = 0; // No cortar handlers SQLite por inactividad mientras la operación siga activa.

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo abrir el puerto interno del servidor POSVEN3.');
  process.parentPort.postMessage({ type: 'ready', port: address.port, pid: process.pid });
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (server?.listening) {
    await new Promise(resolve => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
    });
  }
  if (application?.close) await application.close();
  application = null;
  server = null;
  process.parentPort.postMessage({ type: 'stopped' });
  setImmediate(() => process.exit(0));
}

process.parentPort.on('message', event => {
  if (event?.data?.type === 'shutdown') {
    shutdown().catch(error => {
      console.error('[POSVEN3 worker] Error al cerrar:', error);
      process.exit(1);
    });
  }
});

start().catch(error => {
  console.error('[POSVEN3 worker] No se pudo iniciar:', error);
  process.parentPort.postMessage({ type: 'error', error: error?.message || String(error) });
  setTimeout(() => process.exit(1), 50);
});
