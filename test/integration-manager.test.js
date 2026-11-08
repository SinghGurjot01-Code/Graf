import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IntegrationManager } from '../src/main/integration-manager.js';

test('Antigravity config integration preserves unrelated MCP servers and creates backup', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-mcp-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const configPath = path.join(home, '.gemini', 'antigravity', 'mcp_config.json');
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const original = { mcpServers: { supabase: { serverUrl: 'https://example.invalid/mcp' }, other: { command: 'other.exe', args: [] } } };
  await fs.writeFile(configPath, JSON.stringify(original, null, 2));
  const manager = new IntegrationManager({ app: { isPackaged: false }, corePath: path.join(root, 'core'), homeDir: home });
  const project = path.join(root, 'my-project'); await fs.mkdir(project);
  const result = await manager.configureAntigravity(project);
  const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(saved.mcpServers.supabase.serverUrl, original.mcpServers.supabase.serverUrl);
  assert.deepEqual(saved.mcpServers.other, original.mcpServers.other);
  assert.equal(saved.mcpServers.graf.args.at(-1), project);
  assert.ok(result.backup);
  await fs.access(result.backup);
});

test('Antigravity config integration refuses malformed JSON without overwriting it', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-mcp-invalid-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'); const configPath = path.join(home, '.gemini', 'antigravity', 'mcp_config.json');
  await fs.mkdir(path.dirname(configPath), { recursive: true }); await fs.writeFile(configPath, '{broken');
  const manager = new IntegrationManager({ app: { isPackaged: false }, corePath: path.join(root, 'core'), homeDir: home });
  await assert.rejects(manager.configureAntigravity(root), /invalid/);
  assert.equal(await fs.readFile(configPath, 'utf8'), '{broken');
});

test('client config targets correct project files and preserves unrelated VS Code servers', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-mcp-clients-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'); const project = path.join(root, 'project');
  await fs.mkdir(project, { recursive: true });
  const vscodePath = path.join(project, '.vscode', 'mcp.json');
  await fs.mkdir(path.dirname(vscodePath), { recursive: true });
  await fs.writeFile(vscodePath, JSON.stringify({ inputs: [], servers: { localDb: { type: 'stdio', command: 'db-tool' } } }));
  const manager = new IntegrationManager({ app: { isPackaged: false }, corePath: path.join(root, 'core'), homeDir: home, platform: 'win32', env: { APPDATA: path.join(home, 'Roaming') } });
  const result = await manager.configure('vscode', project);
  const saved = JSON.parse(await fs.readFile(vscodePath, 'utf8'));
  assert.equal(result.configPath, vscodePath);
  assert.equal(saved.servers.localDb.command, 'db-tool');
  assert.equal(saved.servers.graf.type, 'stdio');
  assert.equal(saved.servers.graf.args.at(-1), project);
  await manager.disconnect('vscode', project);
  const disconnected = JSON.parse(await fs.readFile(vscodePath, 'utf8'));
  assert.equal(disconnected.servers.graf, undefined);
  assert.equal(disconnected.servers.localDb.command, 'db-tool');
});

test('Antigravity workspace configuration is placed in the project .agents folder', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-antigravity-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'); await fs.mkdir(project);
  const manager = new IntegrationManager({ app: { isPackaged: false }, corePath: path.join(root, 'core'), homeDir: path.join(root, 'home') });
  const result = await manager.configure('antigravity-workspace', project);
  assert.equal(result.configPath, path.join(project, '.agents', 'mcp_config.json'));
  assert.equal(JSON.parse(await fs.readFile(result.configPath, 'utf8')).mcpServers.graf.args.at(-1), project);
});

test('live MCP handshake confirms initialization and all fourteen tools', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-mcp-handshake-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'); await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'index.js'), 'export const ready = true;\n');
  const manager = new IntegrationManager({ app: { isPackaged: false }, corePath: path.resolve('core'), homeDir: path.join(root, 'home') });
  const result = await manager.testMcp(project, 15000);
  assert.equal(result.ok, true);
  assert.equal(result.toolCount, 14);
  assert.ok(result.tools.includes('get_context'));
});

async function fakeMachine(t, { platform = 'linux', installed = [], nodeOnPath = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-machine-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), bin = path.join(root, 'bin'), project = path.join(root, 'project');
  await fs.mkdir(home, { recursive: true }); await fs.mkdir(bin); await fs.mkdir(project);
  const exe = name => platform === 'win32' ? `${name}.exe` : name;
  if (nodeOnPath) await fs.writeFile(path.join(bin, exe('node')), '');
  for (const name of installed) await fs.writeFile(path.join(bin, exe(name)), '');
  const env = { PATH: bin, ...(platform === 'win32' ? { PATHEXT: '.EXE;.CMD', LOCALAPPDATA: path.join(home, 'AppData', 'Local'), APPDATA: path.join(home, 'AppData', 'Roaming') } : {}) };
  const manager = new IntegrationManager({ app: { isPackaged: false }, corePath: path.resolve('core'), homeDir: home, env, platform });
  return { root, home, bin, project, manager };
}

test('install detection comes from real evidence, not from a folder merely existing', async t => {
  const m = await fakeMachine(t, { installed: ['claude'] });
  assert.match(m.manager.installEvidence('claude-code'), /claude/);
  assert.equal(m.manager.installEvidence('cursor'), null);
  assert.equal(m.manager.installEvidence('vscode'), null);
  assert.equal(m.manager.installEvidence('antigravity'), null);
  await fs.mkdir(path.join(m.home, '.gemini', 'antigravity'), { recursive: true });
  assert.match(m.manager.installEvidence('antigravity'), /antigravity/);
  assert.match(m.manager.installEvidence('antigravity-workspace'), /antigravity/, 'workspace entry shares the app');
});

test('Windows detection uses LOCALAPPDATA/APPDATA from the environment, never a fixed user path', async t => {
  const m = await fakeMachine(t, { platform: 'win32', installed: [] });
  assert.equal(m.manager.installEvidence('cursor'), null);
  await fs.mkdir(path.join(m.home, 'AppData', 'Local', 'Programs', 'cursor'), { recursive: true });
  assert.match(m.manager.installEvidence('cursor'), /AppData/);
  assert.equal(m.manager.getConfigPath('claude-desktop'), path.join(m.home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'));
  const src = await fs.readFile(path.resolve('src/main/integration-manager.js'), 'utf8');
  assert.ok(!/C:\\\\Users|\/home\/[a-z]|\/Users\/[a-z]/i.test(src.replace(/\/Users\/\$\{/g, '')), 'no hardcoded user directories in the source');
});

test('status reports installed state honestly and the correct Antigravity path', async t => {
  const m = await fakeMachine(t, { installed: ['code'] });
  const status = await m.manager.status(m.project);
  const by = id => status.clients.find(c => c.client === id);
  assert.equal(by('vscode').installed, true);
  assert.equal(by('cursor').installed, false);
  assert.equal(by('claude-code').installed, false);
  assert.equal(by('antigravity').configPath, path.join(m.home, '.gemini', 'antigravity', 'mcp_config.json'));
  assert.equal(status.runtime.source, 'system');
  assert.equal(status.runtime.ok, false, 'an empty placeholder file on PATH is found but cannot run, and is reported as broken');
  m.manager.env.GRAF_NODE_PATH = process.execPath;
  assert.equal((await m.manager.status(m.project)).runtime.ok, true);
  const noProject = await m.manager.status(undefined);
  assert.equal(noProject.clients.find(c => c.client === 'cursor').needsProject, true);
  assert.equal(noProject.clients.find(c => c.client === 'cursor').parseError, null);
});

test('connect refuses a client that is not installed, and works once it is or when forced', async t => {
  const m = await fakeMachine(t, { installed: [] });
  // use the real Node as the "system node" so the runtime check genuinely runs
  m.manager.env.GRAF_NODE_PATH = process.execPath;
  await assert.rejects(m.manager.connect('cursor', m.project), /does not appear to be installed/);
  await assert.rejects(fs.access(path.join(m.project, '.cursor', 'mcp.json')), 'nothing was written');
  const forced = await m.manager.connect('cursor', m.project, { force: true });
  assert.equal(forced.configured, true);
  await fs.writeFile(path.join(m.bin, 'claude'), '');
  assert.equal((await m.manager.connect('claude-code', m.project)).configured, true);
});

test('connect is blocked with a clear message when Node is missing', async t => {
  const m = await fakeMachine(t, { installed: ['claude'], nodeOnPath: false });
  const rt = await m.manager.checkRuntime();
  assert.equal(rt.ok, false);
  assert.match(rt.problem, /Node\.js was not found/);
  await assert.rejects(m.manager.connect('claude-code', m.project), /Node\.js was not found/);
});

test('an old Node is rejected', async t => {
  const m = await fakeMachine(t);
  m.manager.env.GRAF_NODE_PATH = process.execPath;
  m.manager.testRuntime = async () => ({ ok: true, version: 'v18.19.0' }); // pretend the runtime reports an old version (portable: no fake executables)
  const rt = await m.manager.checkRuntime();
  assert.equal(rt.ok, false); assert.match(rt.problem, /too old/);
  m.manager.testRuntime = async () => ({ ok: true, version: 'v22.5.0' });
  assert.equal((await m.manager.checkRuntime()).ok, true, 'the minimum supported version passes');
});

test('on Windows, extensionless npm shims and .cmd files are never chosen as the Node runtime', async t => {
  const m = await fakeMachine(t, { platform: 'win32', nodeOnPath: false });
  await fs.writeFile(path.join(m.bin, 'node'), '#!/bin/sh\n');       // what node_modules/.bin contains on Windows
  await fs.writeFile(path.join(m.bin, 'node.cmd'), '@echo off\r\n');
  assert.equal(m.manager.resolveRuntime().source, 'missing', 'shims are not runnable');
  await fs.writeFile(path.join(m.bin, 'node.exe'), '');
  assert.equal(m.manager.resolveRuntime().path, path.join(m.bin, 'node.exe'));
  assert.ok(m.manager.which('node'), 'general lookups may still find .cmd launchers such as code.cmd');
});

test('manual setup returns the exact path and snippet and writes nothing', async t => {
  const m = await fakeMachine(t);
  const manual = await m.manager.manualSetup('vscode', m.project);
  assert.equal(manual.configPath, path.join(m.project, '.vscode', 'mcp.json'));
  const snippet = JSON.parse(manual.snippet);
  assert.equal(snippet.servers.graf.type, 'stdio');
  assert.equal(snippet.servers.graf.args.at(-1), m.project);
  await assert.rejects(fs.access(manual.configPath), 'manual setup must not write');
  await assert.rejects(m.manager.manualSetup('vscode'), /Open a project/);
});
