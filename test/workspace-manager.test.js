import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceManager } from '../src/main/workspace-manager.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-desktop-test-'));
  const project = path.join(root, 'sample-project');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'index.js'), 'export function hello() { return "graf"; }\n');
  const manager = new WorkspaceManager({ userDataPath: path.join(root, 'app-data') });
  await manager.init();
  return { root, project, manager, cleanup: async () => { await manager.shutdown(); await fs.rm(root, { recursive: true, force: true }); } };
}

test('workspace manager opens a local project and returns real Graf graph metrics', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.manager.addProject(f.project);
  const opened = await f.manager.openProject(f.project);
  assert.equal(opened.project.path, f.project);
  assert.ok(opened.status.files >= 1);
  assert.ok(opened.status.nodes >= 1);
  const graph = await f.manager.graphData();
  assert.ok(graph.nodes.some(node => node.name === 'hello'));
});

test('workspace manager searches, reads and builds context from the real engine', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.manager.openProject(f.project);
  const results = await f.manager.search('hello', 'function');
  assert.equal(results[0].name, 'hello');
  const source = await f.manager.readNode(results[0].id, 1);
  assert.match(source.source, /return "graf"/);
  const context = await f.manager.getContext('hello', 700, true, true);
  assert.ok(context.context.results.length);
});

test('workspace manager keeps graph layout in application data, not source project', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.manager.openProject(f.project);
  await f.manager.saveLayout({ 'file:index.js': { x: 12, y: 34 }, bad: { x: Infinity, y: 1 } });
  const layout = await f.manager.getLayout();
  assert.deepEqual(layout['file:index.js'], { x: 12, y: 34 });
  assert.equal(layout.bad, undefined);
  await assert.rejects(fs.access(path.join(f.project, '.graf-layout.json')));
});

test('reopening the active project reuses its engine and does not open a second SQLite connection', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.manager.openProject(f.project);
  const firstEngine = f.manager.active.engine;
  const reopened = await f.manager.openProject(f.project);
  assert.equal(reopened.reused, true);
  assert.strictEqual(f.manager.active.engine, firstEngine);
  assert.ok(reopened.status.files >= 1);
});

test('proposal approval validates every change before applying any change', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.manager.openProject(f.project);
  const engine = f.manager.active.engine;
  const node = engine.search('hello', 'function')[0];
  const proposal = engine.proposeChanges({
    rationale: 'Regression test for all-or-nothing approval.',
    changes: [
      { type: 'add_note', text: 'This note must not be partially applied.', node_id: node.id },
      { type: 'unsupported_change' }
    ]
  });
  const notesBefore = Object.keys(engine.store.data.notes).length;
  await assert.rejects(f.manager.approveProposal(proposal.id), /Unsupported proposal change type/);
  assert.equal(Object.keys(engine.store.data.notes).length, notesBefore);
  assert.equal(engine.store.data.proposals[proposal.id].status, 'pending');
});

test('file explorer reads complete indexed source in bounded pages', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const lines = Array.from({ length: 920 }, (_, i) => `export const value${i} = ${i};`);
  await fs.writeFile(path.join(f.project, 'index.js'), lines.join('\n'));
  await f.manager.openProject(f.project, { fullSync: true });
  const first = await f.manager.readFile('index.js', 1, 400);
  assert.equal(first.lineStart, 1);
  assert.equal(first.lineEnd, 400);
  assert.equal(first.totalLines, 920);
  assert.equal(first.hasMore, true);
  const next = await f.manager.readFile('index.js', 401, 400);
  assert.match(next.source, /^401: export const value400/);
  await assert.rejects(f.manager.readFile('../escape.js'), /not part of the current Graf index/);
});

test('manual graph relationships can be removed but source-derived edges cannot', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.manager.openProject(f.project);
  const engine = f.manager.active.engine;
  const node = engine.search('hello', 'function')[0];
  const file = engine.search('index.js', 'file')[0];
  const added = await f.manager.addCustomEdge({ src: file.id, dst: node.id, type: 'documents', confidence: 1 });
  assert.equal(added.provenance, 'manual');
  await f.manager.removeCustomEdge(added.id);
  assert.equal(Object.values(engine.store.data.edges).some(e => e.id === added.id), false);
  const derived = Object.values(engine.store.data.edges).find(e => e.provenance !== 'manual');
  if (derived) await assert.rejects(f.manager.removeCustomEdge(derived.id), /Only human-created/);
});

test('memory edits persist and backup restore retains a safety copy', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.manager.openProject(f.project);
  const node = f.manager.active.engine.search('hello', 'function')[0];
  const memory = await f.manager.addMemory({ title: 'Original decision', content: 'Keep this function small.', linkedNodes: [node.id] });
  await f.manager.updateMemory(memory.id, { title: 'Updated decision', content: 'Keep the function focused.', linkedNodes: [node.id] });
  const backupDir = path.join(f.root, 'backups');
  const backup = await f.manager.createBackup(backupDir);
  await f.manager.updateMemory(memory.id, { title: 'Temporary change', content: 'This will be rolled back.', linkedNodes: [node.id] });
  const restored = await f.manager.restoreBackup(backup.backupPath);
  assert.equal(restored.restored, true);
  assert.ok(restored.safetyBackup);
  const result = await f.manager.getMemories();
  assert.equal(result.find(m => m.id === memory.id).title, 'Updated decision');
});

test('workspace manager coalesces concurrent refresh calls into a single operation', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.manager.openProject(f.project);
  const [e1, e2, e3] = await Promise.all([
    f.manager.refresh(),
    f.manager.refresh(),
    f.manager.refresh()
  ]);
  assert.equal(e1, f.manager.active.engine);
  assert.equal(e2, f.manager.active.engine);
  assert.equal(e3, f.manager.active.engine);
});

test('manual graph nodes persist through source re-indexing and support manual edges', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.manager.openProject(f.project);
  const node = await f.manager.addManualNode({ name: 'Deployment decision', summary: 'Keep deployment local.' });
  assert.equal(node.kind, 'note');
  assert.equal(node.provenance, 'manual');
  await f.manager.sync({ full: true });
  const result = await f.manager.getNode(node.id);
  assert.equal(result.name, 'Deployment decision');
  assert.equal(result.summary, 'Keep deployment local.');
});

test('source explorer rejects an indexed symlink that resolves outside the repository', async t => {
  if (process.platform === 'win32') return t.skip('Symlink creation may require elevated privileges on Windows.');
  const f = await fixture(); t.after(f.cleanup);
  await f.manager.openProject(f.project);
  const outside = path.join(f.root, 'outside-secret.txt');
  await fs.writeFile(outside, 'do not expose');
  await fs.symlink(outside, path.join(f.project, 'linked.txt'));
  f.manager.active.engine.store.data.files['linked.txt'] = { path: 'linked.txt', hash: 'fixture', mtime: 1, language: 'text', parseOk: true };
  await f.manager.active.engine.store.save();
  await assert.rejects(f.manager.readFile('linked.txt'), /resolves outside the selected project/);
});
