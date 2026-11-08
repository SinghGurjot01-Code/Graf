import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('packaged app includes Graf Core modules imported by the main process', () => {
  const files = pkg.build.files;
  assert.ok(files.includes('core/src/**/*'));
  assert.ok(files.includes('core/bin/**/*'));
  assert.ok(fs.existsSync(path.join(root, 'core/src/engine.js')));
  assert.ok(fs.existsSync(path.join(root, 'core/src/parser/index.js')));
});

test('packaged app includes the separately spawned MCP Core resources', () => {
  const resources = pkg.build.extraResources;
  assert.ok(resources.some(item => item.from === 'core' && item.to === 'core'));
  assert.ok(resources.some(item => item.from === 'runtime/win-x64' && item.to === 'runtime'));
});

test('Windows installer target is x64 NSIS and has a stable artifact name', () => {
  assert.equal(pkg.build.win.target[0].target, 'nsis');
  assert.deepEqual(pkg.build.win.target[0].arch, ['x64']);
  assert.match(pkg.build.artifactName, /Graf-Setup-/);
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
});
