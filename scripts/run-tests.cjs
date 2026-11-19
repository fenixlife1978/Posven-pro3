const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const testDirectory = path.join(root, 'tests');
const testFiles = fs.readdirSync(testDirectory)
  .filter((name) => name.endsWith('.test.cjs'))
  .sort()
  .map((name) => path.join(testDirectory, name));

if (testFiles.length === 0) {
  console.error('No se encontraron pruebas *.test.cjs en tests/.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: root,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status === null ? 1 : result.status);
