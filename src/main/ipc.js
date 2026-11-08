import { ipcMain, dialog, shell, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const stringArg = (value, label, max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must be a non-empty string under ${max} characters.`);
  return value.trim();
};

export function registerIpc({ workspace, integrations, getMainWindow, getPreferences, setPreferences, getTrayState, setLoginItem }) {
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    const win = getMainWindow();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unauthorized IPC sender.');
    return fn(...args);
  });
  handle('app:info', async () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, electronVersion: process.versions.electron, homedir: os.homedir() }));
  handle('app:preferences:get', async () => ({ ...getPreferences(), login: app.getLoginItemSettings?.() || {}, loginItemAvailable: ['win32','darwin'].includes(process.platform), trayAvailable: Boolean(getTrayState()) }));
  handle('app:preferences:set', async patch => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Preferences must be an object.');
    const allowed = ['closeToTray']; const next = {};
    for (const key of allowed) if (patch[key] !== undefined) { if (typeof patch[key] !== 'boolean') throw new Error(`${key} must be a boolean.`); next[key] = patch[key]; }
    if (patch.startOnLogin !== undefined) {
      if (typeof patch.startOnLogin !== 'boolean') throw new Error('startOnLogin must be a boolean.');
      setLoginItem(patch.startOnLogin);
    }
    return setPreferences(next);
  });
  handle('projects:list', async () => workspace.listProjectsChecked());
  handle('projects:rename', async (projectPath, name) => workspace.renameProject(stringArg(projectPath, 'Project path'), stringArg(name, 'Project name', 80)));
  handle('projects:active', async () => workspace.activeProject());
  handle('projects:choose', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), { title: 'Select a code project', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('projects:add', async projectPath => workspace.addProject(stringArg(projectPath, 'Project path')));
  handle('projects:open', async (projectPath, options) => workspace.openProject(stringArg(projectPath, 'Project path'), options || {}));
  handle('projects:remove', async projectPath => workspace.removeProject(stringArg(projectPath, 'Project path')));
  handle('projects:close', async () => workspace.closeActive());
  handle('project:overview', async depth => workspace.overview(depth));
  handle('project:sync', async full => workspace.sync({ full: Boolean(full) }));
  handle('project:status', async () => workspace.status());
  handle('project:files', async () => workspace.listFiles());
  handle('project:read-file', async (filePath, start, count) => workspace.readFile(stringArg(filePath, 'File path', 3000), start, count));
  handle('project:diagnostics', async () => workspace.diagnostics());
  handle('project:backup', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), { title: 'Choose where to save Graf backup', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return workspace.createBackup(result.filePaths[0]);
  });
  handle('project:restore-backup', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), { title: 'Select a Graf .graf-backup folder', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return workspace.restoreBackup(result.filePaths[0]);
  });
  handle('graph:data', async options => workspace.graphData(options || {}));
  handle('graph:layout:get', async () => workspace.getLayout());
  handle('graph:layout:save', async layout => workspace.saveLayout(layout));
  handle('tree:get', async options => workspace.tree(options && typeof options === 'object' ? options : {}));
  handle('usage:summary', async options => workspace.usage(options && typeof options === 'object' ? options : {}));
  handle('usage:all', async () => workspace.usageAllProjects());
  handle('usage:clear', async () => workspace.clearUsage());
  handle('graph:search', async (query, kind) => workspace.search(stringArg(query, 'Search query', 500), kind));
  handle('graph:node', async id => workspace.getNode(stringArg(id, 'Node ID', 1000)));
  handle('graph:neighbors', async (id, types, depth) => workspace.neighbors(stringArg(id, 'Node ID', 1000), Array.isArray(types) ? types : [], depth));
  handle('graph:impact', async id => workspace.impact(stringArg(id, 'Node ID', 1000)));
  handle('graph:read', async (id, padding) => workspace.readNode(stringArg(id, 'Node ID', 1000), padding));
  handle('graph:node:add', async input => workspace.addManualNode(input));
  handle('graph:edge:add', async input => workspace.addCustomEdge(input));
  handle('graph:edge:remove', async id => workspace.removeCustomEdge(stringArg(id, 'Relationship ID', 2000)));
  handle('graph:node:summary', async (id, summary) => workspace.setNodeSummary(stringArg(id, 'Node ID', 1000), stringArg(summary, 'Summary', 500)));
  handle('graph:node:hidden', async (id, hidden) => workspace.setNodeHidden(stringArg(id, 'Node ID', 1000), Boolean(hidden)));
  handle('graph:node:pin', async (id, pinned, weight) => workspace.setNodePinned(stringArg(id, 'Node ID', 1000), Boolean(pinned), weight));
  handle('context:get', async input => {
    if (!input || typeof input !== 'object') throw new Error('Context options are required.');
    return workspace.getContext(stringArg(input.query, 'Context query', 2000), input.maxTokens, input.includeDependencies !== false, input.includeMemory !== false);
  });
  handle('context:export', async (format, content) => {
    if (!['markdown', 'json'].includes(format)) throw new Error('Unsupported context format.');
    if (typeof content !== 'string' || !content.trim() || content.length > 2_000_000) throw new Error('Context export is empty or too large.');
    const ext = format === 'markdown' ? 'md' : 'json';
    const result = await dialog.showSaveDialog(getMainWindow(), { defaultPath: `graf-context.${ext}`, filters: [{ name: format.toUpperCase(), extensions: [ext] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, content, 'utf8');
    return { exported: result.filePath };
  });
  handle('memory:list', async () => workspace.getMemories());
  handle('memory:add', async input => workspace.addMemory(input));
  handle('memory:update', async (id, patch) => workspace.updateMemory(stringArg(id, 'Memory ID', 1000), patch));
  handle('memory:approve', async id => workspace.approveMemory(stringArg(id, 'Memory ID', 1000)));
  handle('memory:archive', async id => workspace.archiveMemory(stringArg(id, 'Memory ID', 1000)));
  handle('memory:delete', async id => workspace.deleteMemory(stringArg(id, 'Memory ID', 1000)));
  handle('notes:list', async () => workspace.listNotes());
  handle('notes:for-node', async id => workspace.notesForNode(stringArg(id, 'Node ID', 1000)));
  handle('notes:add', async input => workspace.addNote(input));
  handle('history:list', async () => workspace.snapshots());
  handle('history:snapshot', async label => workspace.createSnapshot(label));
  handle('history:diff', async ref => workspace.diff(stringArg(ref, 'Snapshot reference', 1000)));
  handle('history:restore', async (ref, options) => workspace.restore(stringArg(ref, 'Snapshot reference', 1000), options || {}));
  handle('changes:list', async ref => workspace.changesSince(ref));
  handle('proposals:list', async () => workspace.listProposals());
  handle('proposals:approve', async id => workspace.approveProposal(stringArg(id, 'Proposal ID', 1000)));
  handle('proposals:reject', async id => workspace.rejectProposal(stringArg(id, 'Proposal ID', 1000)));
  handle('integrations:status', async () => integrations.status(workspace.activeProject()?.path));
  handle('integrations:configure', async (client, options) => integrations.connect(stringArg(client, 'MCP client', 100), workspace.activeProject()?.path, { force: Boolean(options?.force) }));
  handle('integrations:commands-status', async () => integrations.commandsStatus(workspace.activeProject()?.path));
  handle('integrations:commands-install', async options => integrations.commandsInstall(workspace.activeProject()?.path, { rule: Boolean(options?.rule) }));
  handle('integrations:commands-remove', async () => integrations.commandsRemove(workspace.activeProject()?.path));
  handle('integrations:manual', async client => integrations.manualSetup(stringArg(client, 'MCP client', 100), workspace.activeProject()?.path));
  handle('integrations:disconnect', async client => integrations.disconnect(stringArg(client, 'MCP client', 100), workspace.activeProject()?.path));
  handle('integrations:test-runtime', async () => integrations.testRuntime());
  handle('integrations:test-mcp', async () => integrations.testMcp(workspace.activeProject()?.path));
  handle('export:graph', async (format, suggestedName) => {
    if (!['json', 'markdown', 'jsonl'].includes(format)) throw new Error('Unsupported export format.');
    const ext = format === 'markdown' ? 'md' : format;
    const result = await dialog.showSaveDialog(getMainWindow(), { defaultPath: suggestedName || `graf-export.${ext}`, filters: [{ name: format.toUpperCase(), extensions: [ext] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const data = await workspace.exportBundle(format);
    await fs.writeFile(result.filePath, data, 'utf8');
    return { exported: result.filePath };
  });
  handle('shell:open-path', async target => {
    stringArg(target, 'Path', 4000);
    if (!path.isAbsolute(target)) throw new Error('An absolute path is required.');
    // Only folders may be opened directly: shell.openPath() on a script (.js, .bat, .ps1) would execute it on Windows.
    const stat = await fs.stat(target).catch(() => null);
    if (!stat?.isDirectory()) throw new Error('Only folders can be opened. Use “Reveal in folder” for files.');
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return { opened: true };
  });
  handle('shell:reveal-file', async relativePath => {
    const root = workspace.activeProject()?.path;
    if (!root) throw new Error('Open a project first.');
    const target = path.resolve(root, stringArg(relativePath, 'File path', 3000));
    const rel = path.relative(path.resolve(root), target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('That file is outside the project.');
    shell.showItemInFolder(target);
    return { revealed: true };
  });
  handle('project:open-grafignore', async () => {
    const file = await workspace.ensureGrafIgnore();
    const error = await shell.openPath(file);
    if (error) { shell.showItemInFolder(file); }
    return { path: file };
  });
}
