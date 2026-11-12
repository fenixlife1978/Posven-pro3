'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const { X509Certificate } = require('node:crypto');

async function requestWithPin(url, expectedFingerprint) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { rejectUnauthorized: false, minVersion: 'TLSv1.2', timeout: 5000 }, response => {
      const peer = response.socket.getPeerCertificate(true);
      const actual = peer?.raw ? crypto.createHash('sha256').update(peer.raw).digest('hex') : '';
      if (actual !== expectedFingerprint) {
        response.destroy();
        reject(new Error('TLS_PIN_MISMATCH'));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('timeout', () => request.destroy(new Error('TLS_TEST_TIMEOUT')));
    request.on('error', reject);
  });
}

async function main() {
  const [pfxPath, cerPath] = process.argv.slice(2);
  const password = process.env.POSVEN_TLS_TEST_PASSWORD;
  assert.ok(pfxPath && cerPath && password, 'Faltan los archivos o la contraseña de prueba TLS.');
  const cert = new X509Certificate(fs.readFileSync(cerPath));
  const expected = cert.fingerprint256.replace(/:/g, '').toLowerCase();
  const server = https.createServer({
    pfx: fs.readFileSync(pfxPath),
    passphrase: password,
    minVersion: 'TLSv1.2',
  }, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: true, database: 'sqlite' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    const url = 'https://127.0.0.1:' + address.port + '/api/pos/health';
    const accepted = await requestWithPin(url, expected);
    assert.equal(accepted.status, 200);
    assert.deepEqual(JSON.parse(accepted.body), { ok: true, database: 'sqlite' });

    await assert.rejects(
      requestWithPin(url, '0'.repeat(64)),
      error => error.message === 'TLS_PIN_MISMATCH',
    );
    console.log('TLS local: handshake correcto, huella SHA-256 aceptada y huella incorrecta rechazada.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
