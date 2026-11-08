import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { AntigravityCommands } from './antigravity-commands.js';

const clone = value => JSON.parse(JSON.stringify(value));
const CLIENTS = Object.freeze({
  antigravity: { label: 'Antigravity · Global', scope: 'global', key: 'mcpServers', filename: 'mcp_config.json', app: 'antigravity', note: 'Antigravity IDE: ~/.gemini/antigravity/mcp_config.json' },
  'antigravity-workspace': { label: 'Antigravity · Workspace', scope: 'project', key: 'mcpServers', filename: 'mcp_config.json', app: 'antigravity', note: 'Workspace config in .agents/. If your Antigravity version does not pick it up, use the global entry or manual setup.' },
  'claude-desktop': { label: 'Claude Desktop', scope: 'global', key: 'mcpServers', filename: 'claude_desktop_config.json', app: 'claude-desktop' },
  'claude-code': { label: 'Claude Code', scope: 'project', key: 'mcpServers', filename: '.mcp.json', app: 'claude-code' },
  cursor: { label: 'Cursor', scope: 'project', key: 'mcpServers', filename: 'mcp.json', app: 'cursor' },
  vscode: { label: 'Visual Studio Code', scope: 'project', key: 'servers', filename: 'mcp.json', app: 'vscode' }
});
const MIN_NODE = [22, 5]; // node:sqlite, used by the Graf engine, needs Node 22.5+
const parseNodeVersion = text => { const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(String(text)); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
const nodeVersionOk = v => v && (v[0] > MIN_NODE[0] || (v[0] === MIN_NODE[0] && v[1] >= MIN_NODE[1]));


function parseConfig(raw, label) {
  let value;
  try { value = JSON.parse(raw); } catch (error) { throw new Error(`${label} contains invalid JSON. Nothing was changed: ${error.message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must contain a JSON object.`);
  return value;
}

function atomicConfigWrite(filePath, content) {
  return fs.mkdir(path.dirname(filePath), { recursive: true }).then(async () => {
    const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try { await fs.writeFile(tmp, `${JSON.stringify(content, null, 2)}\n`, 'utf8'); await fs.rename(tmp, filePath); }
    catch (error) { await fs.rm(tmp, { force: true }).catch(() => {}); throw error; }
  });
}

export class IntegrationManager {
  constructor({ app, corePath, homeDir = os.homedir(), env = process.env, platform = process.platform }) {
    this.app = app; this.corePath = corePath; this.homeDir = homeDir; this.env = env; this.platform = platform;
    this.commands = new AntigravityCommands({ homeDir: this.homeDir });
  }

  /**
   * Looks a command up on PATH the way a shell would. On Windows only real PATHEXT extensions count: extensionless
   * npm shims (node_modules/.bin/node) cannot be started, so they are never returned. `exeOnly` is for commands we
   * spawn ourselves, which Windows can only start as .exe.
   */
  which(command, { exeOnly = false } = {}) {
    const win = this.platform === 'win32';
    const dirs = String(this.env.PATH || this.env.Path || '').split(win ? ';' : ':').filter(Boolean);
    let exts = [''];
    if (win) {
      exts = String(this.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).map(e => e.toLowerCase());
      exts = exeOnly ? ['.exe'] : ['.exe', ...exts.filter(e => e !== '.exe')];
    }
    for (const dir of dirs) for (const ext of exts) { const candidate = path.join(dir, command + ext); if (existsSync(candidate)) return candidate; }
    return null;
  }

  /** Where Node comes from: the bundled runtime in an installed build, an explicit override, or Node on PATH. */
  resolveRuntime() {
    const exe = this.platform === 'win32' ? 'node.exe' : 'node';
    const bundled = this.app.isPackaged && process.resourcesPath ? path.join(process.resourcesPath, 'runtime', exe) : null;
    if (bundled && existsSync(bundled)) return { path: bundled, source: 'bundled' };
    if (this.env.GRAF_NODE_PATH) return { path: this.env.GRAF_NODE_PATH, source: 'override' };
    const found = this.which('node', { exeOnly: true });
    if (found) return { path: found, source: 'system' };
    return { path: bundled || null, source: 'missing' };
  }
  getNodeRuntimePath() { return this.resolveRuntime().path || (this.platform === 'win32' ? 'node.exe' : 'node'); }

  /** Real check: is there a runnable Node, and is it new enough for Graf? */
  async checkRuntime() {
    const resolved = this.resolveRuntime();
    if (!resolved.path) return { ...resolved, ok: false, version: null, problem: 'Node.js was not found. Install Node.js 22.5 or newer from nodejs.org, then restart Graf.' };
    try {
      const { version } = await this.testRuntime(resolved.path);
      const parsed = parseNodeVersion(version);
      if (!nodeVersionOk(parsed)) return { ...resolved, ok: false, version, problem: `Node ${version} is too old. Graf needs Node ${MIN_NODE.join('.')} or newer.` };
      return { ...resolved, ok: true, version, problem: null };
    } catch (error) { return { ...resolved, ok: false, version: null, problem: `Node could not be started: ${error.message}` }; }
  }

  /** Evidence that the client application is installed on this computer, or null. */
  installEvidence(client) {
    const descriptor = CLIENTS[client]; if (!descriptor) return null;
    const home = this.homeDir, env = this.env, win = this.platform === 'win32', mac = this.platform === 'darwin';
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
    const appBundles = name => mac ? ['/Applications', path.join(home, 'Applications')].map(dir => path.join(dir, `${name}.app`)) : [];
    const spec = {
      antigravity: { bins: ['antigravity', 'agy'], paths: [...(win ? [path.join(local, 'Programs', 'Antigravity'), path.join(local, 'Antigravity')] : []), ...appBundles('Antigravity'), path.join(home, '.gemini', 'antigravity')] },
      'claude-desktop': { bins: [], paths: [...(win ? [path.join(local, 'AnthropicClaude'), path.join(local, 'Programs', 'Claude'), path.join(roaming, 'Claude')] : []), ...appBundles('Claude'), ...(!win && !mac ? [path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude')] : []), ...(mac ? [path.join(home, 'Library', 'Application Support', 'Claude')] : [])] },
      'claude-code': { bins: ['claude'], paths: [path.join(home, '.claude'), path.join(home, '.local', 'bin', win ? 'claude.exe' : 'claude')] },
      cursor: { bins: ['cursor'], paths: [...(win ? [path.join(local, 'Programs', 'cursor'), path.join(local, 'Programs', 'Cursor'), ...programFiles.map(d => path.join(d, 'Cursor'))] : []), ...appBundles('Cursor'), path.join(home, '.cursor')] },
      vscode: { bins: ['code'], paths: [...(win ? [path.join(local, 'Programs', 'Microsoft VS Code'), ...programFiles.map(d => path.join(d, 'Microsoft VS Code'))] : []), ...appBundles('Visual Studio Code'), path.join(home, '.vscode')] }
    }[descriptor.app];
    for (const bin of spec.bins) { const hit = this.which(bin); if (hit) return `Found ${bin} at ${hit}`; }
    for (const candidate of spec.paths) if (existsSync(candidate)) return `Found ${candidate}`;
    return null;
  }

  getConfigPath(client, projectRoot) {
    const home = this.homeDir;
    switch (client) {
      case 'antigravity': return path.join(home, '.gemini', 'antigravity', 'mcp_config.json');
      case 'antigravity-workspace': if (!projectRoot) throw new Error('Open a project before configuring Antigravity workspace MCP.'); return path.join(projectRoot, '.agents', 'mcp_config.json');
      case 'claude-desktop':
        if (this.platform === 'win32') return path.join(this.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
        if (this.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        return path.join(this.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude', 'claude_desktop_config.json');
      case 'claude-code': if (!projectRoot) throw new Error('Open a project before configuring Claude Code.'); return path.join(projectRoot, '.mcp.json');
      case 'cursor': if (!projectRoot) throw new Error('Open a project before configuring Cursor.'); return path.join(projectRoot, '.cursor', 'mcp.json');
      case 'vscode': if (!projectRoot) throw new Error('Open a project before configuring VS Code.'); return path.join(projectRoot, '.vscode', 'mcp.json');
      default: throw new Error(`Unsupported MCP client: ${client}`);
    }
  }

  async readConfig(client, projectRoot) {
    const descriptor = CLIENTS[client];
    if (!descriptor) throw new Error(`Unsupported MCP client: ${client}`);
    const configPath = this.getConfigPath(client, projectRoot);
    let config = {}, exists = false, parseError = null;
    try { config = parseConfig(await fs.readFile(configPath, 'utf8'), configPath); exists = true; }
    catch (error) { if (error.code !== 'ENOENT') parseError = error.message; }
    const servers = config[descriptor.key];
    const validServers = servers && typeof servers === 'object' && !Array.isArray(servers);
    return { client, label: descriptor.label, configPath, configExists: exists, scope: descriptor.scope, note: descriptor.note || null, installEvidence: this.installEvidence(client), installed: Boolean(this.installEvidence(client)), detected: Boolean(this.installEvidence(client)), parseError, grafConfigured: Boolean(validServers && servers.graf), grafConfig: validServers ? servers.graf || null : null, configKey: descriptor.key };
  }

  async status(projectRoot) {
    const runtime = await this.checkRuntime();
    const clients = await Promise.all(Object.keys(CLIENTS).map(async client => {
      try { return await this.readConfig(client, projectRoot); }
      catch (error) { return { client, label: CLIENTS[client].label, scope: CLIENTS[client].scope, configPath: null, installed: Boolean(this.installEvidence(client)), installEvidence: this.installEvidence(client), detected: false, grafConfigured: false, parseError: CLIENTS[client].scope === 'project' && !projectRoot ? null : error.message, needsProject: CLIENTS[client].scope === 'project' && !projectRoot }; }
    }));
    return { clients, runtime, runtimePath: runtime.path, corePath: this.corePath, runtimeAvailable: runtime.ok, packaged: Boolean(this.app.isPackaged), platform: this.platform, hasProject: Boolean(projectRoot) };
  }

  /** The gated path used by the UI: Node must work, and the client must really be installed (unless the user insists). */
  async connect(client, projectRoot, { force = false } = {}) {
    const descriptor = CLIENTS[client];
    if (!descriptor) throw new Error(`Unsupported MCP client: ${client}`);
    const runtime = await this.checkRuntime();
    if (!runtime.ok) throw new Error(runtime.problem);
    if (!force && !this.installEvidence(client)) throw new Error(`${descriptor.label} does not appear to be installed on this computer. Install it first, use “Set up manually”, or choose “Connect anyway”.`);
    return this.configure(client, projectRoot);
  }

  /** What to paste by hand when automatic setup is not possible. Nothing is written. */
  async manualSetup(client, projectRoot) {
    const descriptor = CLIENTS[client];
    if (!descriptor) throw new Error(`Unsupported MCP client: ${client}`);
    if (!projectRoot) throw new Error('Open a project first so Graf knows which folder to serve.');
    const configPath = this.getConfigPath(client, projectRoot);
    const runtime = this.resolveRuntime();
    const args = [path.join(this.corePath, 'bin', 'graf.js'), 'serve', '--root', path.resolve(projectRoot)];
    const command = runtime.path || (this.platform === 'win32' ? 'node.exe' : 'node');
    const server = descriptor.key === 'servers' ? { type: 'stdio', command, args, cwd: path.resolve(projectRoot), env: {} } : { command, args, cwd: path.resolve(projectRoot) };
    return {
      client, label: descriptor.label, configPath, configDirExists: existsSync(path.dirname(configPath)), configExists: existsSync(configPath),
      snippet: JSON.stringify({ [descriptor.key]: { graf: server } }, null, 2), key: descriptor.key,
      runtimeFound: Boolean(runtime.path), steps: [
        `Open (or create) ${configPath}.`,
        `Add the "graf" entry inside the "${descriptor.key}" object. Keep any other servers that are already there.`,
        `Save the file and restart ${descriptor.label.split(' · ')[0]} so it reloads its MCP servers.`
      ]
    };
  }

  async configure(client, projectRoot) {
    const descriptor = CLIENTS[client];
    if (!descriptor) throw new Error(`Unsupported MCP client: ${client}`);
    if (descriptor.scope === 'project' && !projectRoot) throw new Error(`Open a project before configuring ${descriptor.label}.`);
    const configPath = this.getConfigPath(client, projectRoot);
    let config = {}, hadExistingConfig = false;
    try { config = parseConfig(await fs.readFile(configPath, 'utf8'), configPath); hadExistingConfig = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }

    if (descriptor.key === 'servers') {
      config.servers ||= {};
      if (typeof config.servers !== 'object' || Array.isArray(config.servers)) throw new Error('VS Code servers configuration must be an object.');
    } else {
      config.mcpServers ||= {};
      if (typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) throw new Error('MCP servers configuration must be an object.');
    }
    const servers = config[descriptor.key];
    const runtime = this.getNodeRuntimePath();
    if (this.app.isPackaged && !(await fs.access(runtime).then(() => true).catch(() => false))) throw new Error('Bundled Node.js runtime is missing. Reinstall Graf or run diagnostics.');
    const args = [path.join(this.corePath, 'bin', 'graf.js'), 'serve', '--root', path.resolve(projectRoot)];
    const server = descriptor.key === 'servers'
      ? { type: 'stdio', command: runtime, args, cwd: path.resolve(projectRoot), env: {} }
      : { command: runtime, args, cwd: path.resolve(projectRoot) };
    servers.graf = server;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = hadExistingConfig ? `${configPath}.graf-backup-${timestamp}` : null;
    if (backup) await fs.copyFile(configPath, backup);
    await atomicConfigWrite(configPath, config);
    return { configured: true, client, label: descriptor.label, configPath, backup, projectRoot: path.resolve(projectRoot), command: runtime, args };
  }

  async disconnect(client, projectRoot) {
    const descriptor = CLIENTS[client];
    if (!descriptor) throw new Error(`Unsupported MCP client: ${client}`);
    const configPath = this.getConfigPath(client, projectRoot);
    const original = parseConfig(await fs.readFile(configPath, 'utf8'), configPath);
    const config = clone(original);
    if (config[descriptor.key]) delete config[descriptor.key].graf;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${configPath}.graf-backup-${timestamp}`;
    await fs.copyFile(configPath, backup);
    await atomicConfigWrite(configPath, config);
    return { disconnected: true, client, configPath, backup };
  }


  commandsStatus(projectRoot) { return this.commands.status(projectRoot); }
  commandsInstall(projectRoot, options) { return this.commands.install(projectRoot, options); }
  commandsRemove(projectRoot) { return this.commands.remove(projectRoot); }

  async configureAntigravity(projectRoot) { return this.configure('antigravity', projectRoot); }
  async disconnectAntigravity() { return this.disconnect('antigravity'); }

  async testRuntime(runtimePath) {
    const runtime = runtimePath || this.getNodeRuntimePath();
    return new Promise((resolve, reject) => {
      const child = spawn(runtime, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', settled = false;
      const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
      const timer = setTimeout(() => { child.kill(); finish(reject, new Error('Node runtime test timed out.')); }, 5000);
      child.stdout.on('data', b => stdout += b.toString());
      child.stderr.on('data', b => stderr += b.toString());
      child.once('error', error => finish(reject, error));
      child.once('close', code => code === 0 ? finish(resolve, { ok: true, version: stdout.trim() }) : finish(reject, new Error(stderr.trim() || `Node exited with code ${code}`)));
    });
  }

  async testMcp(projectRoot, timeoutMs = 15000) {
    if (!projectRoot) throw new Error('Open a project before testing Graf MCP.');
    const runtime = this.getNodeRuntimePath();
    const serverPath = path.join(this.corePath, 'bin', 'graf.js');
    await fs.access(serverPath);

    return new Promise((resolve, reject) => {
      const child = spawn(runtime, [serverPath, 'serve', '--root', path.resolve(projectRoot)], {
        cwd: projectRoot,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      const pending = new Map();
      let seq = 0;
      let stderr = '';
      let finished = false;
      let outcome = null;
      let timer;
      let forceKillTimer;

      const request = (method, params = {}) => new Promise((res, rej) => {
        const id = ++seq;
        pending.set(id, { res, rej });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, error => {
          if (!error) return;
          pending.delete(id);
          rej(error);
        });
      });

      const finish = (error, result) => {
        if (finished) return;
        finished = true;
        outcome = { error, result };
        clearTimeout(timer);

        // EOF lets the CLI leave its readline loop and run its finally block,
        // which closes the graph store and SQLite handles. Do not resolve yet:
        // on Windows, deleting the test project before the child emits `close`
        // races with SQLite/WAL cleanup and intermittently fails with EBUSY.
        try { child.stdin.end(); } catch {}

        // The normal path is graceful shutdown. This is only a safety net for
        // a wedged child so diagnostics cannot leave a process behind forever.
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill();
        }, 5000);
        forceKillTimer.unref?.();
      };

      rl.on('line', line => {
        try {
          const msg = JSON.parse(line);
          const task = pending.get(msg.id);
          if (!task) return;
          pending.delete(msg.id);
          if (msg.error) task.rej(new Error(msg.error.message || 'MCP request failed.'));
          else task.res(msg.result);
        } catch { /* ignore non-JSON diagnostic lines */ }
      });

      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk.toString()).slice(-8000);
      });

      child.once('error', error => finish(error));
      child.once('close', (code, signal) => {
        clearTimeout(forceKillTimer);
        clearTimeout(timer);
        rl.close();
        for (const task of pending.values()) task.rej(new Error('Graf MCP process closed before completing the handshake.'));
        pending.clear();

        if (!finished) {
          reject(new Error(`Graf MCP exited before handshake completed (code ${code ?? 'unknown'}, signal ${signal || 'none'}). ${stderr.trim()}`));
          return;
        }
        if (outcome.error) reject(outcome.error);
        else if (code !== 0) reject(new Error(`Graf MCP exited with code ${code} after handshake. ${stderr.trim()}`));
        else resolve(outcome.result);
      });

      timer = setTimeout(() => {
        finish(new Error(`Graf MCP handshake timed out after ${timeoutMs} ms. ${stderr.trim()}`));
      }, timeoutMs);

      (async () => {
        try {
          const initialized = await request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'graf-desktop-diagnostics', version: '1.0.1' }
          });
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
          const tools = await request('tools/list');
          finish(null, {
            ok: true,
            serverInfo: initialized.serverInfo,
            protocolVersion: initialized.protocolVersion,
            toolCount: tools.tools?.length || 0,
            tools: (tools.tools || []).map(tool => tool.name)
          });
        } catch (error) {
          finish(error);
        }
      })();
    });
  }
}

export const SUPPORTED_MCP_CLIENTS = Object.keys(CLIENTS).map(client => ({ id: client, label: CLIENTS[client].label, scope: CLIENTS[client].scope }));
