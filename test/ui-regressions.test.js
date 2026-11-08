import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceManager } from '../src/main/workspace-manager.js';
import { GrafEngine } from '../core/src/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFile(path.join(root, rel), 'utf8');
async function tempProject(files = { 'src/auth.js': 'export function validateSession(s) { return !!s; }\nexport function handleLogin(r) { return validateSession(r.session); }\n' }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-ui-'));
  for (const [rel, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await fs.writeFile(path.join(dir, rel), content); }
  return dir;
}
async function manager() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-ud-'));
  const w = new WorkspaceManager({ userDataPath: userData }); await w.init(); return w;
}

test('main window registers ready-to-show before loading, so it can never stay hidden', async () => {
  const src = await read('src/main/main.js');
  assert.ok(src.indexOf("once('ready-to-show'") > -1 && src.indexOf("once('ready-to-show'") < src.indexOf('await mainWindow.loadFile'));
  assert.match(src, /setTimeout\(reveal/, 'a fallback must reveal the window if the event is missed');
});

test('shell:open-path only opens folders (opening a script would execute it on Windows)', async () => {
  const src = await read('src/main/ipc.js');
  assert.match(src, /isDirectory\(\)/);
  assert.match(src, /shell:reveal-file/);
});

test('project list reports folders that no longer exist', async () => {
  const w = await manager(); const dir = await tempProject();
  await w.addProject(dir);
  assert.equal((await w.listProjectsChecked())[0].exists, true);
  await fs.rm(dir, { recursive: true, force: true });
  assert.equal((await w.listProjectsChecked())[0].exists, false);
  await w.shutdown?.();
});

test('renaming a project persists and survives reopening and the active-project lookup', async () => {
  const w = await manager(); const dir = await tempProject();
  await w.addProject(dir); await w.openProject(dir);
  await w.renameProject(dir, 'My Service');
  assert.equal(w.activeProject().name, 'My Service');
  await w.openProject(dir);
  assert.equal(w.listProjects()[0].name, 'My Service', 'opening a project must not reset its custom name');
  await assert.rejects(() => w.renameProject(dir, '   '), /1–80/);
  await w.shutdown?.();
});

test('.grafignore is created on demand and .gitignore is never touched', async () => {
  const w = await manager(); const dir = await tempProject({ 'src/a.js': 'export const a = 1;\n', '.gitignore': 'node_modules\n' });
  await w.addProject(dir); await w.openProject(dir);
  const file = await w.ensureGrafIgnore();
  assert.equal(path.basename(file), '.grafignore');
  assert.match(await fs.readFile(file, 'utf8'), /Graf ignore rules/);
  assert.equal(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), 'node_modules\n');
  await fs.writeFile(file, 'custom\n'); await w.ensureGrafIgnore();
  assert.equal(await fs.readFile(file, 'utf8'), 'custom\n', 'an existing .grafignore must be preserved');
  await w.shutdown?.();
});

test('context building ranks nodes for task-style queries instead of requiring every word', async () => {
  const dir = await tempProject(); const engine = new GrafEngine(dir); await engine.init(); await engine.sync({});
  const result = engine.getContext('please check the login session flow', 1200);
  const names = (result.results || result.context?.results || []).map(n => n.name);
  assert.ok(names.includes('handleLogin') && names.includes('validateSession'), `got ${names}`);
  assert.equal((engine.getContext('zzzqqq nonsense', 1200).results || []).length, 0);
  engine.close();
});

test('every data-action rendered by the UI has a registered handler', async () => {
  const src = await read('src/renderer/app.js');
  const body = src.slice(src.indexOf('const actions = {'), src.indexOf('Event wiring'));
  const handlers = new Set([...body.matchAll(/(?:^\s{2}(\w+)|'([\w-]+)'):\s*(?:async\s+)?(?:\(|\w+\s*=>)/gm)].map(m => m[1] || m[2]));
  const used = new Set();
  for (const m of src.matchAll(/data-action="([\w-]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bbtn\(\s*(?:'(?:[^'\\]|\\.)*'|"[^"]*"|`[^`]*`)\s*,\s*'([\w-]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/\biconBtn\(\s*'\w+'\s*,\s*'([\w-]+)'/g)) used.add(m[1]);
  const missing = [...used].filter(a => !handlers.has(a));
  assert.deepEqual(missing, [], `actions without handlers: ${missing}`);
  assert.ok(used.size > 50, 'expected the scan to find the UI actions');
});

test('renderer never calls blocking native dialogs', async () => {
  const src = await read('src/renderer/app.js');
  assert.doesNotMatch(src, /(^|[^\w.])(confirm|alert|prompt)\s*\(/m);
});

test('icon names used in the renderer all exist in the icon set', async () => {
  const icons = await read('src/renderer/icons.js');
  const defined = new Set([...icons.slice(icons.indexOf('const P = {'), icons.indexOf('export function icon')).matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]));
  const app = await read('src/renderer/app.js');
  const used = new Set([...app.matchAll(/\bicon\('(\w+)'/g)].map(m => m[1]));
  for (const m of app.matchAll(/\b[ia]: '(\w+)'/g)) used.add(m[1]);
  for (const m of app.matchAll(/\biconBtn\('(\w+)'/g)) used.add(m[1]);
  const missing = [...used].filter(n => !defined.has(n));
  assert.deepEqual(missing, [], `unknown icons: ${missing}`);
});
