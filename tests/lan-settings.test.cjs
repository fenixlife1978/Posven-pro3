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
