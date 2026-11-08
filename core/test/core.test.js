import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSource, shouldIgnore } from '../src/parser/index.js';
import { McpServer } from '../src/mcp/server.js';
import { GrafEngine } from '../src/engine.js';

test('parser extracts file and function symbols', () => {
  const parsed = parseSource('src/auth.js', 'export function login(user) { return validate(user); }\nfunction validate(x) { return !!x; }');
  assert.equal(parsed.nodes[0].kind, 'file');
  assert.ok(parsed.nodes.some(n => n.name === 'login' && n.kind === 'function'));
  assert.ok(parsed.nodes.some(n => n.name === 'validate' && n.kind === 'function'));
  assert.ok(parsed.edges.some(e => e.type === 'defines'));
});

test('ignore rules exclude secrets and generated directories', () => {
  assert.equal(shouldIgnore('.env'), true);
  assert.equal(shouldIgnore('node_modules/a.js'), true);
  assert.equal(shouldIgnore('src/a.js', 'src/generated'), false);
  assert.equal(shouldIgnore('src/generated/a.js', 'src/generated'), true);
});

test('engine indexes, searches, snapshots and restores', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-test-'));
  let engine;
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src/app.js'), 'export function boot() { return true; }');
    engine = new GrafEngine(root); await engine.init(); const sync = await engine.sync();
    assert.equal(sync.indexed, 1);
    assert.equal(engine.search('boot')[0].name, 'boot');
    const version = await engine.snapshot('before');
    await fs.writeFile(path.join(root, 'src/app.js'), 'export function start() { return false; }');
    await engine.sync();
    assert.ok(engine.search('start').length);
    await engine.restore(version.id);
    assert.ok(engine.search('boot').length);
  } finally { engine?.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('MCP server initializes and exposes exactly fourteen tools', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-mcp-'));
  let engine;
  try {
    engine = new GrafEngine(root); await engine.init();
    const server = new McpServer(engine);
    const initialized = await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(initialized.result.serverInfo.name, 'graf');
    assert.equal(initialized.result.serverInfo.version, '0.2.4');
    const tools = await server.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.equal(tools.result.tools.length, 14);
    const overview = await server.dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'overview', arguments: { depth: 0 } } });
    assert.equal(overview.result.isError, false);
  } finally { engine?.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('parser supports Python, Java and route extraction with provenance', async () => {
  const { parseSource } = await import('../src/parser/index.js');
  const py = parseSource('app.py', 'class User:\n    def login(self, name):\n        return name\n');
  assert.ok(py.nodes.some(n => n.kind === 'class' && n.name === 'User'));
  assert.ok(py.nodes.some(n => n.kind === 'function' && n.name === 'login'));
  const java = parseSource('UserService.java', 'public class UserService {\n public User login(String name) { return null; }\n}');
  assert.ok(java.nodes.some(n => n.kind === 'class' && n.name === 'UserService'));
  const js = parseSource('routes.js', "app.post('/api/login', login);\nfunction login() {}\n");
  assert.ok(js.nodes.some(n => n.kind === 'route' && n.name === 'POST /api/login' && n.provenance === 'inferred'));
  assert.ok(js.edges.some(e => e.type === 'handles' && e.provenance === 'inferred'));
});

test('agent memories are pending until a human approves them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-memory-'));
  let engine;
  try {
    engine = await new GrafEngine(root).init();
    const memory = engine.addMemory({ title: 'Agent observation', content: 'Review this', source: 'agent' });
    assert.equal(memory.status, 'pending');
    assert.equal(engine.memorySearch('observation').length, 0);
    assert.equal(engine.getContext('observation').context.memories.length, 0);
    engine.approveMemory(memory.id);
    assert.equal(engine.memorySearch('observation').length, 1);
    assert.equal(engine.getContext('observation').context.memories.length, 1);
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('MCP rejects invalid tool arguments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-mcp-invalid-'));
  let engine;
  try {
    engine = await new GrafEngine(root).init();
    const response = await new McpServer(engine).dispatch({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'search', arguments: { query: 123 } } });
    assert.equal(response.result.isError, true);
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('SQLite projection is created and env templates store names, never values', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-sqlite-'));
  let engine;
  try {
    await fs.writeFile(path.join(root, '.env.example'), 'API_URL=https://example.invalid\nPUBLIC_TOKEN=placeholder\n');
    await fs.writeFile(path.join(root, '.env'), 'LIVE_SECRET=do-not-index\n');
    engine = await new GrafEngine(root).init();
    await engine.sync();
    assert.ok(engine.store.backend === 'sqlite' || engine.store.backend === 'json');
    const configs = Object.values(engine.store.data.nodes).filter(n => n.kind === 'config');
    assert.ok(configs.some(n => n.name === 'API_URL'));
    assert.ok(!JSON.stringify(engine.store.data).includes('do-not-index'));
    if (engine.store.backend === 'sqlite') {
      const rows = engine.store.db.prepare('SELECT count(*) AS count FROM nodes').get();
      assert.ok(rows.count > 0);
    }
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Git branches retain separate graph states', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-branches-'));
  const { execFileSync } = await import('node:child_process');
  let engine;
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'graf@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Graf Test'], { cwd: root });
    await fs.writeFile(path.join(root, 'main.js'), 'export function mainTask() {}');
    execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-m', 'main'], { cwd: root });
    engine = await new GrafEngine(root).init(); await engine.sync();
    execFileSync('git', ['switch', '-c', 'feature'], { cwd: root });
    await fs.writeFile(path.join(root, 'feature.js'), 'export function featureTask() {}');
    execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-m', 'feature'], { cwd: root });
    await engine.sync();
    assert.ok(engine.store.data.files['feature.js']);
    engine.close();
    execFileSync('git', ['switch', 'main'], { cwd: root });
    const restarted = await new GrafEngine(root).init(); await restarted.sync();
    assert.ok(restarted.store.data.files['main.js']);
    assert.ok(!restarted.store.data.files['feature.js']);
    restarted.close();
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('human overrides and custom edges survive source re-indexing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-overlay-'));
  let engine;
  try {
    await fs.mkdir(path.join(root, 'src'));
    const file = path.join(root, 'src', 'app.js');
    await fs.writeFile(file, 'export function alpha() {}\nexport function beta() {}\n');
    engine = await new GrafEngine(root).init(); await engine.sync();
    const alpha = engine.search('alpha')[0], beta = engine.search('beta')[0];
    engine.setSummary(alpha.id, 'Human-owned summary');
    engine.addCustomEdge({ src: alpha.id, dst: beta.id, type: 'custom-link' });
    engine.setHidden(beta.id, true);
    await engine.store.save();
    await fs.writeFile(file, 'export function alpha() { return 1; }\nexport function beta() {}\n');
    await engine.sync();
    assert.equal(engine.getNode(alpha.id).summary, 'Human-owned summary');
    assert.equal(engine.getNode(beta.id).hidden, true);
    assert.ok(Object.values(engine.store.data.edges).some(e => e.provenance === 'manual' && e.type === 'custom-link'));
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true }); }
});



test('getContext returns results, handles empty matches and enforces token budgets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-context-'));
  let engine;
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', 'context.js'), 'export function contextTarget() { return true; }');
    engine = await new GrafEngine(root).init();
    await engine.sync();

    const populated = engine.getContext('contextTarget');
    assert.equal(populated.context.results.length, 1);
    assert.equal(populated.context.results[0].name, 'contextTarget');
    assert.ok(Array.isArray(populated.context.memories));

    const empty = engine.getContext('no-such-symbol-xyz');
    assert.deepEqual(empty.context.results, []);
    assert.deepEqual(empty.context.memories, []);

    for (let i = 0; i < 5; i++) {
      engine.addMemory({ title: `contextTarget memory ${i}`, content: `contextTarget ${'detail '.repeat(80)}` });
    }
    const bounded = engine.getContext('contextTarget', 100, true, true, true);
    assert.ok(bounded.estimatedTokens <= 100);
    assert.equal(bounded.truncated, true);
  } finally { engine?.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('MCP get_context returns a successful tool result', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-mcp-context-'));
  let engine;
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', 'mcp-context.js'), 'export function mcpContextTarget() {}');
    engine = await new GrafEngine(root).init();
    await engine.sync();
    const response = await new McpServer(engine).dispatch({
      jsonrpc: '2.0', id: 19, method: 'tools/call',
      params: { name: 'get_context', arguments: { query: 'mcpContextTarget' } }
    });
    assert.equal(response.result.isError, false);
    assert.equal(response.result.structuredContent.context.results[0].name, 'mcpContextTarget');
  } finally { engine?.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('memory lifecycle preserves approval and visibility rules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-memory-lifecycle-'));
  let engine;
  try {
    engine = await new GrafEngine(root).init();
    const pending = engine.addMemory({ title: 'Pending architecture memory', content: 'architecture search content', source: 'agent' });
    const active = engine.addMemory({ title: 'Human memory', content: 'human searchable content', source: 'developer' });
    assert.throws(() => engine.approveMemory(active.id), /Only pending memories can be approved/);
    assert.throws(() => engine.updateMemory(pending.id, { status: 'active' }), /approved with approveMemory/);

    const listed = engine.listMemories();
    assert.ok(listed.some(m => m.id === pending.id));
    assert.ok(listed.some(m => m.id === active.id));
    assert.equal(engine.memorySearch('architecture').length, 0);

    engine.approveMemory(pending.id);
    assert.equal(engine.memorySearch('architecture').length, 1);
    engine.archiveMemory(pending.id);
    assert.equal(engine.memorySearch('architecture').length, 0);
    assert.equal(engine.getContext('architecture').context.memories.length, 0);
    assert.throws(() => engine.approveMemory(pending.id), /Only pending memories can be approved/);

    engine.deleteMemory(active.id);
    assert.ok(!engine.listMemories().some(m => m.id === active.id));
    assert.equal(engine.memorySearch('human searchable').length, 0);
    assert.throws(() => engine.archiveMemory(active.id), /Deleted memories cannot be archived/);
  } finally { engine?.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('CLI memory subcommands create, list, approve, archive and delete', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-cli-memory-'));
  const cliPath = fileURLToPath(new URL('../bin/graf.js', import.meta.url));
  const run = (...args) => execFileSync(process.execPath, [cliPath, ...args, '--root', root], { encoding: 'utf8' }).trim();
  try {
    const created = JSON.parse(run('memory', 'CLI human memory', 'remember this workflow'));
    assert.equal(created.status, 'active');
    let seedEngine = await new GrafEngine(root).init();
    const pending = seedEngine.addMemory({ title: 'CLI agent memory', content: 'approve this workflow', source: 'agent' });
    await seedEngine.store.save();
    seedEngine.close();
    seedEngine = null;

    const listedBefore = JSON.parse(run('memory', 'list'));
    assert.ok(listedBefore.some(m => m.id === created.id));
    assert.ok(listedBefore.some(m => m.id === pending.id && m.status === 'pending'));

    const approved = JSON.parse(run('memory', 'approve', pending.id));
    assert.equal(approved.status, 'active');
    assert.equal(approved.approvedBy, 'human');
    const archived = JSON.parse(run('memory', 'archive', pending.id));
    assert.equal(archived.status, 'archived');
    const deleted = JSON.parse(run('memory', 'delete', pending.id));
    assert.equal(deleted.deleted, true);

    const listedAfter = JSON.parse(run('memory', 'list'));
    assert.ok(!listedAfter.some(m => m.id === pending.id));
    assert.ok(listedAfter.some(m => m.id === created.id));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('database close is idempotent and releases SQLite files for deletion', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-close-'));
  const engine = await new GrafEngine(root).init();
  try {
    await engine.store.save();
    engine.close();
    engine.close();
    assert.equal(engine.store.db, null);
    await fs.rm(root, { recursive: true, force: true });
    assert.equal(await fs.stat(root).then(() => true, () => false), false);
  } finally { engine.close(); await fs.rm(root, { recursive: true, force: true }); }
});


test('live MCP process observes CLI memory approvals and stale sync cannot revert them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-memory-cross-process-'));
  let liveEngine;
  try {
    liveEngine = await new GrafEngine(root).init();
    const pending = liveEngine.addMemory({
      title: 'Cross-process approval test',
      content: 'external approval must remain visible to live MCP',
      source: 'agent'
    });
    await liveEngine.store.save();

    const cliPath = fileURLToPath(new URL('../bin/graf.js', import.meta.url));
    const run = (...args) => execFileSync(process.execPath, [cliPath, ...args, '--root', root], { encoding: 'utf8' }).trim();
    const approved = JSON.parse(run('memory', 'approve', pending.id));
    assert.equal(approved.status, 'active');
    assert.equal(approved.approvedBy, 'human');

    // The already-running MCP process must refresh external CLI changes before
    // serving a read tool, without needing a restart.
    const response = await new McpServer(liveEngine).dispatch({
      jsonrpc: '2.0', id: 77, method: 'tools/call',
      params: { name: 'memory_search', arguments: { query: 'Cross-process approval test' } }
    });
    assert.equal(response.result.isError, false);
    assert.ok(response.result.structuredContent.some(memory => memory.id === pending.id && memory.status === 'active'));

    // Simulate a long-running MCP watcher saving after another process made
    // the approval. The stale process must not revert the newer memory status.
    await liveEngine.store.save();
    await liveEngine.sync();

    const listed = JSON.parse(run('memory', 'list'));
    assert.ok(listed.some(memory => memory.id === pending.id && memory.status === 'active'));

    const graphJson = JSON.parse(await fs.readFile(path.join(root, '.graf', 'graph.json'), 'utf8'));
    assert.equal(graphJson.memories[pending.id].status, 'active');
  } finally {
    liveEngine?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
