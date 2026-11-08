import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GrafEngine } from '../core/src/engine.js';
import { McpServer } from '../core/src/mcp/server.js';
import { filterTree, expandedToDepth, expandAll, pathTo, isRealNode } from '../src/renderer/tree-helpers.js';

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-tree-'));
  await fs.mkdir(path.join(root, 'src/lib'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/index.js'), "import { a } from './lib/a.js';\nimport { b } from './lib/b.js';\nexport function main() { return a() + b(); }\n");
  await fs.writeFile(path.join(root, 'src/lib/a.js'), "import { b } from './b.js';\nexport function a() { return b(); }\n");
  await fs.writeFile(path.join(root, 'src/lib/b.js'), "export class Box { open() { return 1; } }\nexport function b() { return 2; }\n");
  await fs.writeFile(path.join(root, 'notes.py'), 'def lonely():\n    return 1\n');
  const engine = new GrafEngine(root); await engine.init(); await engine.sync();
  return { root, engine };
}
const ids = (node, out = []) => { out.push(node.id); node.children.forEach(c => ids(c, out)); return out; };

test('structure tree nests project > folders > files > symbols', async () => {
  const { root, engine } = await project();
  try {
    const { roots, total } = engine.tree({ mode: 'structure' });
    assert.equal(roots.length, 1);
    assert.equal(roots[0].kind, 'project');
    const all = ids(roots[0]);
    assert.ok(all.includes('file:src/lib/b.js'));
    assert.ok(all.some(i => i.startsWith('function:src/lib/b.js#b')));
    const file = JSON.stringify(roots[0]);
    assert.ok(total >= 9, `expected a real tree, got ${total}`);
    const lib = roots[0].children.find(c => c.name === 'src')?.children.find(c => c.name === 'lib');
    assert.ok(lib, 'src/lib folder exists');
    assert.equal(lib.children.filter(c => c.kind === 'file').length, 2);
    assert.ok(file.includes('Box'));
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('a function after a class is not mistaken for one of its methods', async () => {
  const { root, engine } = await project();
  try {
    const find = (n, id) => n.id === id ? n : n.children.map(c => find(c, id)).find(Boolean);
    const tree = engine.tree({ mode: 'structure' }).roots[0];
    assert.ok(find(tree, 'function:src/lib/b.js#b'), 'b is a top-level function of the file');
    assert.equal(find(tree, 'function:src/lib/b.js#Box.b'), undefined);
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('methods nest under their class', async () => {
  const { root, engine } = await project();
  try {
    const b = ids(engine.tree({ mode: 'structure' }).roots[0]);
    const flat = engine.tree({ mode: 'structure' }).roots[0];
    const find = (n, id) => n.id === id ? n : n.children.map(c => find(c, id)).find(Boolean);
    const box = find(flat, 'class:src/lib/b.js#Box');
    assert.ok(box, 'class found');
    assert.ok(box.children.some(c => c.name === 'open'), 'method sits under class');
    assert.ok(b.length > 0);
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('import forest: entry file on top, imports below, standalone files grouped, repeats marked', async () => {
  const { root, engine } = await project();
  try {
    const { roots } = engine.tree({ mode: 'dependencies' });
    const entry = roots.find(r => r.id === 'file:src/index.js');
    assert.ok(entry, 'index.js is an entry point');
    assert.deepEqual(entry.children.map(c => c.id).sort(), ['file:src/lib/a.js', 'file:src/lib/b.js']);
    const a = entry.children.find(c => c.id === 'file:src/lib/a.js');
    const b = entry.children.find(c => c.id === 'file:src/lib/b.js');
    const shownTwice = [a, b].flatMap(n => n.children).filter(c => c.id === 'file:src/lib/b.js').length + (b.ref ? 1 : 0);
    assert.ok(a.children.some(c => c.id === 'file:src/lib/b.js') && b.ref, 'b.js is expanded once and marked "shown above" the second time');
    assert.ok(shownTwice >= 1);
    const group = roots.find(r => r.kind === 'group');
    assert.ok(group.children.some(c => c.id === 'file:notes.py'));
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('dependents tree walks backwards from a file', async () => {
  const { root, engine } = await project();
  try {
    const { roots } = engine.tree({ mode: 'dependents', id: 'file:src/lib/b.js', depth: 3 });
    const names = ids(roots[0]);
    assert.ok(names.includes('file:src/lib/a.js') && names.includes('file:src/index.js'));
    assert.throws(() => engine.tree({ mode: 'dependents' }), /needs a node id/);
    assert.throws(() => engine.tree({ mode: 'bogus' }), /mode must be/);
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('tree outline is compact and respects limits', async () => {
  const { root, engine } = await project();
  try {
    const full = engine.treeOutline({ depth: 6, maxNodes: 400 });
    const small = engine.treeOutline({ depth: 1, maxNodes: 400 });
    assert.ok(full.text.includes('file:src/lib/b.js'));
    assert.ok(small.text.length < full.text.length);
    const capped = engine.treeOutline({ depth: 6, maxNodes: 20 });
    assert.ok(capped.nodesShown <= 20);
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('MCP calls are recorded with tokens, time and estimated savings; report_usage compares', async () => {
  const { root, engine } = await project();
  try {
    const mcp = new McpServer(engine);
    const call = (name, args) => mcp.dispatch({ id: 1, method: 'tools/call', params: { name, arguments: args } });
    await mcp.dispatch({ id: 0, method: 'initialize', params: { clientInfo: { name: 'tester' } } });
    for (const [n, a] of [['overview', {}], ['tree', {}], ['search', { query: 'main' }]]) assert.equal((await call(n, a)).result.isError, false);
    assert.equal((await call('report_usage', { task: 't', tokens_used: 1000, duration_ms: 5000, with_graf: true })).result.isError, false);
    assert.equal((await call('report_usage', { task: 't', tokens_used: 4000, duration_ms: 20000, with_graf: false })).result.isError, false);
    assert.equal((await call('report_usage', { task: 't', tokens_used: -5, duration_ms: 1 })).result.isError, true, 'rejects invalid numbers');
    const u = engine.usageSummary();
    assert.equal(u.totals.calls, 3, 'report_usage is not counted as a read call');
    assert.ok(u.totals.responseTokens > 0 && u.totals.avgMs >= 0);
    assert.equal(u.recent[0].client, 'tester');
    assert.equal(u.tasks.withGraf.avgTokens, 1000);
    assert.equal(u.tasks.without.avgTokens, 4000);
    assert.equal(u.graphUpdates.llmTokens, 0);
    assert.ok(u.graphUpdates.syncs >= 1);
    assert.equal(u.byDay.length, 14);
    assert.equal(engine.clearUsage().cleared > 0, true);
    assert.equal(engine.usageSummary().totals.calls, 0);
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('savings are only claimed when files would have been read', async () => {
  const { root, engine } = await project();
  try {
    const mcp = new McpServer(engine);
    await mcp.dispatch({ id: 1, method: 'tools/call', params: { name: 'memory_search', arguments: { query: 'x' } } });
    const u = engine.usageSummary();
    assert.equal(u.totals.savedTokens, 0);
    assert.equal(u.recent[0].baselineTokens, 0);
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('renderer tree helpers: filter, expand, path, real-node check', () => {
  const roots = [{ id: 'project:root', name: 'p', kind: 'project', children: [
    { id: 'dir:src', name: 'src', kind: 'folder', path: 'src', children: [{ id: 'file:src/a.js', name: 'a.js', path: 'src/a.js', kind: 'file', children: [{ id: 'function:src/a.js#go', name: 'go', kind: 'function', children: [] }] }] },
    { id: 'file:z.js', name: 'z.js', path: 'z.js', kind: 'file', children: [] }] }];
  const f = filterTree(roots, 'go');
  assert.equal(f.matches, 1);
  assert.deepEqual([...expandAll(f.roots)].sort(), ['dir:src', 'file:src/a.js', 'project:root']);
  assert.equal(f.roots[0].children.length, 1, 'non-matching branch removed');
  assert.equal(filterTree(roots, '').roots, roots);
  assert.equal(filterTree(roots, 'nothing').roots.length, 0);
  assert.deepEqual([...expandedToDepth(roots, 1)], ['project:root']);
  assert.deepEqual(pathTo(roots, 'function:src/a.js#go'), ['project:root', 'dir:src', 'file:src/a.js']);
  assert.equal(pathTo(roots, 'nope'), null);
  assert.equal(isRealNode('dir:src'), false);
  assert.equal(isRealNode('file:src/a.js'), true);
});
