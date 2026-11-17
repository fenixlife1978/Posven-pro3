const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src/components/modules/ConfigModule.tsx'), 'utf8');

test('Ajustes muestra un panel LAN accesible desde la aplicación', () => {
  assert.match(config, /Configuración de Red LAN/);
  assert.match(config, /openNetworkSettings/);
  assert.match(preload, /openNetworkSettings: \(\) => ipcRenderer\.invoke\('open-network-settings'\)/);
});

test('el panel LAN permite guardar configuración y solicita reinicio seguro', () => {
  assert.match(main, /ipcMain\.handle\('open-network-settings'/);
  assert.match(main, /saveNetworkConfig\(value\)/);
  assert.match(main, /app\.relaunch\(\);\s*app\.quit\(\)/);
});

test('el servidor muestra IP privadas y huella TLS para configurar clientes manualmente', () => {
  assert.match(main, /addresses: networkConfig\?\.mode === 'server' \? getLanIPv4Addresses\(\) : \[\]/);
  assert.match(main, /fingerprint: networkConfig\?\.mode === 'server' \? serverTls\?\.fingerprint/);
  assert.match(config, /IP para las PCs clientes|Direcciones IP para las PCs clientes/);
  assert.match(config, /Huella TLS SHA-256/);
});

test('la configuración cliente valida IP privada y huella SHA-256', () => {
  assert.match(main, /isPrivateIPv4\(host\)/);
  assert.match(main, /Ingrese la huella SHA-256/);
  assert.match(main, /verifyServer\(networkConfig\.host, networkConfig\.port, networkConfig\.fingerprint\)/);
});


test('Next.js y SQLite se ejecutan en un UtilityProcess separado', () => {
  const worker = fs.readFileSync(path.join(root, 'server-worker.js'), 'utf8');
  assert.match(main, /utilityProcess\.fork\(path\.join\(app\.getAppPath\(\), 'server-worker\.js'/);
  assert.match(main, /serverWorkerPort/);
  assert.match(main, /http\.request\([\s\S]*hostname: '127\.0\.0\.1'/);
  assert.match(worker, /require\('next'\)/);
  assert.match(worker, /process\.parentPort\.postMessage\(\{ type: 'ready'/);
  assert.match(worker, /process\.env\.POSVEN_SQLITE_PATH/);
  assert.match(main, /await stopServerWorker\(\)/);
});

test('el instalador incluye el proceso servidor separado', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('server-worker.js'));
});
