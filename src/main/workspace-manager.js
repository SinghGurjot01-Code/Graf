import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { containsSecret } from '../../core/src/parser/index.js';
import { usageSummary } from '../../core/src/insights.js';
import { GrafEngine } from '../../core/src/engine.js';

const clone = value => JSON.parse(JSON.stringify(value));

export class WorkspaceManager {
  constructor({ userDataPath }) {
    this.userDataPath = userDataPath;
    this.projectsFile = path.join(userDataPath, 'projects.json');
    this.layoutFile = path.join(userDataPath, 'graph-layouts.json');
    this.preferencesFile = path.join(userDataPath, 'preferences.json');
    this.preferences = { closeToTray: false };
    this.projects = [];
    this.layouts = {};
    this.active = null;
    this._refreshPromise = null;
    this._lastRefreshedAt = 0;
  }

  async init() {
    await fs.mkdir(this.userDataPath, { recursive: true });
    try { this.projects = JSON.parse(await fs.readFile(this.projectsFile, 'utf8')); } catch { this.projects = []; }
    try { this.layouts = JSON.parse(await fs.readFile(this.layoutFile, 'utf8')); } catch { this.layouts = {}; }
    try { this.preferences = { ...this.preferences, ...JSON.parse(await fs.readFile(this.preferencesFile, 'utf8')) }; } catch {}
    if (!Array.isArray(this.projects)) this.projects = [];
    if (!this.layouts || typeof this.layouts !== 'object') this.layouts = {};
    return { projects: this.listProjects() };
  }

  listProjects() { return clone(this.projects); }
  /** Projects annotated with whether their folder still exists, so the UI can offer repair/remove. */
  async listProjectsChecked() {
    return Promise.all(this.listProjects().map(async project => {
      try { return { ...project, exists: (await fs.stat(project.path)).isDirectory() }; }
      catch { return { ...project, exists: false }; }
    }));
  }
  async renameProject(projectPath, name) {
    const resolved = path.resolve(projectPath);
    const clean = String(name ?? '').trim();
    if (!clean || clean.length > 80) throw new Error('A project name must be 1–80 characters.');
    const project = this.projects.find(p => path.resolve(p.path).toLowerCase() === resolved.toLowerCase());
    if (!project) throw new Error('Project not found.');
    project.name = clean;
    await this.persistProjects();
    return this.listProjectsChecked();
  }
  /** Returns the project's .grafignore path, creating a commented starter file if none exists. Never touches .gitignore. */
  async ensureGrafIgnore() {
    const root = this.requireEngine().root;
    const file = path.join(root, '.grafignore');
    try { await fs.access(file); }
    catch { await fs.writeFile(file, '# Graf ignore rules (gitignore syntax). Paths listed here are not indexed.\n# Example:\n# dist/\n# *.min.js\n', 'utf8'); }
    return file;
  }
  getPreferences() { return clone(this.preferences); }
  async setPreferences(patch) { this.preferences = { ...this.preferences, ...patch }; const tmp = `${this.preferencesFile}.${process.pid}.${randomUUID()}.tmp`; await fs.writeFile(tmp, JSON.stringify(this.preferences, null, 2), 'utf8'); await fs.rename(tmp, this.preferencesFile); return this.getPreferences(); }
  activeProject() {
    if (!this.active) return null;
    const entry = this.projects.find(p => path.resolve(p.path).toLowerCase() === path.resolve(this.active.root).toLowerCase());
    return { path: this.active.root, name: entry?.name || path.basename(this.active.root) };
  }

  async persistProjects() {
    const tmp = `${this.projectsFile}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.projects, null, 2), 'utf8');
    await fs.rename(tmp, this.projectsFile);
  }

  async addProject(projectPath) {
    const resolved = path.resolve(projectPath);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('Select a project folder, not a file.');
    const existing = this.projects.find(p => path.resolve(p.path).toLowerCase() === resolved.toLowerCase());
    if (!existing) this.projects.unshift({ id: `project_${Buffer.from(resolved).toString('base64url').slice(0, 18)}`, name: path.basename(resolved), path: resolved, addedAt: new Date().toISOString(), lastOpenedAt: null });
    await this.persistProjects();
    return this.listProjects();
  }

  async removeProject(projectPath) {
    const resolved = path.resolve(projectPath);
    if (this.active && path.resolve(this.active.root).toLowerCase() === resolved.toLowerCase()) await this.closeActive();
    this.projects = this.projects.filter(p => path.resolve(p.path).toLowerCase() !== resolved.toLowerCase());
    await this.persistProjects();
    return this.listProjects();
  }

  async openProject(projectPath, { fullSync = false } = {}) {
    const resolved = path.resolve(projectPath);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('Project path is not a directory.');

    // Reuse the active engine for the same project. Opening a second GrafEngine
    // against the same SQLite database can create competing connections and
    // stale in-memory state inside one desktop process.
    if (this.active && path.resolve(this.active.root).toLowerCase() === resolved.toLowerCase()) {
      const engine = this.active.engine;
      const initial = engine.syncStatus();
      const sync = await engine.sync({ full: fullSync });
      const project = this.projects.find(item => path.resolve(item.path).toLowerCase() === resolved.toLowerCase());
      if (project) {
        project.lastOpenedAt = new Date().toISOString();
        await this.persistProjects();
      }
      return { project: { path: resolved, name: project?.name || path.basename(resolved) }, initial, sync, status: engine.syncStatus(), reused: true };
    }

    const next = new GrafEngine(resolved);
    try {
      await next.init();
      const initial = next.syncStatus();
      const sync = await next.sync({ full: fullSync });
      if (this.active) this.active.engine.close();
      this.active = { root: resolved, engine: next };
      let project = this.projects.find(p => path.resolve(p.path).toLowerCase() === resolved.toLowerCase());
      if (!project) {
        project = { id: `project_${Buffer.from(resolved).toString('base64url').slice(0, 18)}`, name: path.basename(resolved), path: resolved, addedAt: new Date().toISOString() };
        this.projects.unshift(project);
      }
      project.lastOpenedAt = new Date().toISOString();
      await this.persistProjects();
      return { project: { path: resolved, name: project.name }, initial, sync, status: next.syncStatus() };
    } catch (error) {
      try { next.close(); } catch {}
      throw error;
    }
  }

  async closeActive() {
    if (this.active) {
      this._refreshPromise = null;
      this._lastRefreshedAt = 0;
      try { this.active.engine.close(); } finally { this.active = null; }
    }
  }

  requireEngine() {
    if (!this.active) throw new Error('No project is open. Add or open a project first.');
    return this.active.engine;
  }

  async refresh() {
    const engine = this.requireEngine();
    const now = Date.now();
    if (this._refreshPromise) return this._refreshPromise;
    if (this._lastRefreshedAt && (now - this._lastRefreshedAt < 800)) return engine;
    this._refreshPromise = (async () => {
      try {
        await engine.store.refreshExternal();
        this._lastRefreshedAt = Date.now();
      } finally {
        this._refreshPromise = null;
      }
      return engine;
    })();
    return this._refreshPromise;
  }

  async overview(depth = 0) { const e = await this.refresh(); return e.overview(depth); }
  async sync(options = {}) { const e = this.requireEngine(); this._lastRefreshedAt = 0; const result = await e.sync(options); return { ...result, status: e.syncStatus() }; }
  async status() { const e = await this.refresh(); return e.syncStatus(); }
  async graphData({ limit = 1800 } = {}) {
    const e = await this.refresh();
    const nodes = e.activeNodes().slice(0, Math.max(50, Math.min(Number(limit) || 1800, 4000)));
    const ids = new Set(nodes.map(n => n.id));
    const edges = Object.values(e.store.data.edges).filter(edge => ids.has(edge.src) && ids.has(edge.dst)).slice(0, 7000);
    return { nodes, edges, truncated: e.activeNodes().length > nodes.length, totalNodes: e.activeNodes().length, totalEdges: Object.keys(e.store.data.edges).length };
  }
  async tree(options = {}) { const e = await this.refresh(); return e.tree(options); }
  async usage(options = {}) { const e = await this.refresh(); return e.usageSummary(options); }
  /** Usage and size for every registered project. The active project is read live; others are read straight from their graph database without opening an engine. */
  async usageAllProjects() {
    const rows = [];
    for (const project of this.projects) {
      const row = { id: project.id, name: project.name, path: project.path, active: false, exists: false, files: 0, nodes: 0, totals: null, lastSyncedAt: null };
      try {
        row.exists = (await fs.stat(project.path)).isDirectory();
        let data = null;
        if (this.active && path.resolve(this.active.root).toLowerCase() === path.resolve(project.path).toLowerCase()) {
          await this.refresh(); data = this.active.engine.store.data; row.active = true;
        } else if (row.exists) {
          const dbFile = path.join(project.path, '.graf', 'graph.db');
          if (await fs.access(dbFile).then(() => true, () => false)) {
            const { DatabaseSync } = await import('node:sqlite');
            const db = new DatabaseSync(dbFile, { readOnly: true });
            try { const r = db.prepare('SELECT payload FROM graf_state WHERE id=1').get(); if (r?.payload) data = JSON.parse(r.payload); } finally { db.close(); }
          }
        }
        if (data) {
          row.files = Object.keys(data.files || {}).length;
          row.nodes = Object.values(data.nodes || {}).filter(n => !n.deletedAt && !n.hidden).length;
          row.totals = usageSummary({ store: { data } }).totals;
          row.lastSyncedAt = data.updatedAt || null;
        }
      } catch (error) { row.error = error.message; }
      rows.push(row);
    }
    const sum = key => rows.reduce((s, r) => s + (r.totals?.[key] || 0), 0);
    const baseline = sum('baselineTokens');
    return { projects: rows, totals: { calls: sum('calls'), responseTokens: sum('responseTokens'), baselineTokens: baseline, savedTokens: sum('savedTokens'), savedPct: baseline ? Math.round(sum('savedTokens') / baseline * 100) : 0, measuredMs: sum('measuredMs'), savedMs: sum('savedMs') } };
  }
  async clearUsage() { const e = this.requireEngine(); const r = e.clearUsage(); await e.store.save(); return r; }
  async search(query, kind) { const e = await this.refresh(); return e.search(query, kind); }
  async getNode(id) { const e = await this.refresh(); const node = e.getNode(id); return { ...node, pinned: Boolean(e.store.data.pins[node.id]) }; }
  async neighbors(id, edgeTypes = [], depth = 1) { const e = await this.refresh(); return e.neighbors(id, edgeTypes, depth); }
  async impact(id) { const e = await this.refresh(); return e.impactOf(id); }
  async readNode(id, contextLines = 3) { const e = await this.refresh(); return e.readNode(id, contextLines); }
  async readFile(filePath, startLine = 1, maxLines = 400) {
    const e = await this.refresh();
    const rel = String(filePath || '').replaceAll('\\', '/').replace(/^\/+/, '');
    if (!e.store.data.files[rel]) throw new Error('File is not part of the current Graf index.');
    const absolute = path.resolve(e.root, rel);
    const relative = path.relative(e.root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('File path escapes the selected project.');
    const [realRoot, realFile] = await Promise.all([fs.realpath(e.root), fs.realpath(absolute)]);
    const realRelative = path.relative(realRoot, realFile);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('Indexed file resolves outside the selected project.');
    const source = await fs.readFile(realFile, 'utf8');
    const lines = source.split(/\r?\n/);
    const first = Math.max(1, Math.min(lines.length || 1, Number(startLine) || 1));
    const count = Math.max(50, Math.min(800, Number(maxLines) || 400));
    const last = Math.min(lines.length, first + count - 1);
    return { path: rel, totalLines: lines.length, lineStart: first, lineEnd: last, source: lines.slice(first - 1, last).map((line, index) => `${first + index}: ${line}`).join('\n'), hasMore: last < lines.length };
  }
  async getContext(query, maxTokens = 1200, includeDependencies = true, includeMemory = true) { const e = await this.refresh(); return e.getContext(query, maxTokens, includeDependencies, includeMemory, true); }
  async listFiles() { const e = await this.refresh(); return Object.values(e.store.data.files).sort((a, b) => a.path.localeCompare(b.path)); }
  async getMemories() { const e = await this.refresh(); return e.listMemories(); }
  async addMemory(input) { const e = await this.refresh(); const result = e.addMemory({ ...input, source: 'developer' }); await e.store.save(); return result; }
  async approveMemory(id) { const e = await this.refresh(); const result = e.approveMemory(id); await e.store.save(); return result; }
  async updateMemory(id, patch) { const e = await this.refresh(); const result = e.updateMemory(id, patch); await e.store.save(); return result; }
  async archiveMemory(id) { const e = await this.refresh(); const result = e.archiveMemory(id); await e.store.save(); return result; }
  async deleteMemory(id) { const e = await this.refresh(); const result = e.deleteMemory(id); await e.store.save(); return result; }
  async addNote(input) { const e = await this.refresh(); const result = e.addNote({ ...input, author: 'human', approved: true }); await e.store.save(); return result; }
  async notesForNode(nodeId) { const e = await this.refresh(); return Object.values(e.store.data.notes).filter(n => n.nodeId === nodeId).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  async setNodeSummary(nodeId, summary) { const e = await this.refresh(); const result = e.setSummary(nodeId, summary); await e.store.save(); return result; }
  async setNodeHidden(nodeId, hidden) { const e = await this.refresh(); const result = e.setHidden(nodeId, hidden); await e.store.save(); return result; }
  async setNodePinned(nodeId, pinned, weight = 10) { const e = await this.refresh(); const node = e.getNode(nodeId); if (pinned) { e.store.data.pins[node.id] = { nodeId: node.id, weight: Math.max(0, Math.min(100, Number(weight) || 10)), createdAt: new Date().toISOString() }; e.store.record('pin', 'pin', node.id, null, e.store.data.pins[node.id], 'human'); } else e.unpin(node.id); await e.store.save(); return { nodeId: node.id, pinned: Boolean(pinned) }; }
  async listNotes() { const e = await this.refresh(); return Object.values(e.store.data.notes).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  async addManualNode({ name, summary = '' } = {}) {
    const e = await this.refresh();
    const label = String(name || '').trim().slice(0, 120);
    const detail = String(summary || '').trim().slice(0, 500);
    if (!label) throw new Error('A title is required for a manual graph node.');
    if (containsSecret(`${label} ${detail}`)) throw new Error('Possible secret detected. Manual node was blocked.');
    const node = { id: `manual:${randomUUID()}`, kind: 'note', name: label, path: null, summary: detail, provenance: 'manual', lineStart: null, lineEnd: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), manual: true };
    e.store.upsertNode(node, 'manual-node-create');
    await e.store.save();
    return node;
  }
  async addCustomEdge(input) { const e = await this.refresh(); const result = e.addCustomEdge(input); await e.store.save(); return { ...result, id: `${result.src}|${result.type}|${result.dst}` }; }
  async removeCustomEdge(edgeId) { const e = await this.refresh(); const entry = Object.entries(e.store.data.edges).find(([key, edge]) => key === edgeId || edge.id === edgeId); if (!entry) throw new Error('Relationship not found.'); const [key, edge] = entry; if (edge.provenance !== 'manual') throw new Error('Only human-created relationships can be removed.'); delete e.store.data.edges[key]; e.store.record('human-edge-delete', 'edge', key, edge, null, 'human'); await e.store.save(); return { removed: true, id: key }; }
  async snapshots() { const e = await this.refresh(); return e.store.data.versions.map(v => ({ id: v.id, number: v.number, label: v.label, branch: v.branch, commit: v.commit, createdAt: v.createdAt, nodeCount: Object.keys(v.state?.nodes || {}).length, edgeCount: Object.keys(v.state?.edges || {}).length })).reverse(); }
  async createSnapshot(label) { const e = await this.refresh(); return e.snapshot(label || 'Manual snapshot'); }
  async diff(ref) { const e = await this.refresh(); return e.diffSince(ref); }
  async restore(ref, options = {}) { const e = await this.refresh(); const result = await e.restore(ref, options); return result; }
  async changesSince(ref) { const e = await this.refresh(); return e.changesSince(ref); }
  async listProposals() { const e = await this.refresh(); return Object.values(e.store.data.proposals).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  async approveProposal(id) {
    const e = await this.refresh();
    const proposal = e.store.data.proposals[id];
    if (!proposal) throw new Error('Proposal not found.');
    if (proposal.status !== 'pending') throw new Error('Proposal is not pending.');
    if (!Array.isArray(proposal.changes) || proposal.changes.length === 0) throw new Error('Proposal has no changes.');

    // Validate the complete proposal before applying anything. Keep a rollback
    // copy as a second guard against a Core method rejecting an individual item.
    for (const change of proposal.changes) {
      if (!change || typeof change !== 'object') throw new Error('Proposal contains an invalid change.');
      if (change.type === 'add_note') {
        if (typeof change.text !== 'string' || !change.text.trim()) throw new Error('Proposal note text is required.');
        if (change.node_id) e.getNode(change.node_id);
      } else if (change.type === 'add_memory') {
        if (typeof change.title !== 'string' || !change.title.trim() || typeof change.content !== 'string' || !change.content.trim()) throw new Error('Proposal memory title and content are required.');
        const linkedNodes = change.linked_nodes || [];
        if (!Array.isArray(linkedNodes)) throw new Error('Proposal memory linked_nodes must be an array.');
        for (const nodeId of linkedNodes) e.getNode(nodeId);
      } else if (change.type === 'pin') {
        e.getNode(change.node_id);
        if (change.weight !== undefined && (!Number.isFinite(Number(change.weight)) || Number(change.weight) < 0)) throw new Error('Proposal pin weight must be a non-negative number.');
      } else {
        throw new Error(`Unsupported proposal change type: ${change.type}`);
      }
    }

    const before = clone(e.store.data);
    try {
      for (const change of proposal.changes) {
        if (change.type === 'add_note') e.addNote({ text: change.text, nodeId: change.node_id, author: 'human', approved: true });
        else if (change.type === 'add_memory') e.addMemory({ title: change.title, content: change.content, source: 'developer', linkedNodes: change.linked_nodes || [] });
        else if (change.type === 'pin') {
          const node = e.getNode(change.node_id);
          e.store.data.pins[node.id] = { nodeId: node.id, weight: change.weight ?? 10, createdAt: new Date().toISOString() };
        }
      }
      proposal.status = 'approved'; proposal.approvedAt = new Date().toISOString();
      e.store.record('proposal-approve', 'proposal', id, null, proposal, 'human');
      await e.store.save();
      return proposal;
    } catch (error) {
      e.store.data = before;
      throw error;
    }
  }
  async rejectProposal(id) {
    const e = await this.refresh();
    const proposal = e.store.data.proposals[id];
    if (!proposal) throw new Error('Proposal not found.');
    if (proposal.status !== 'pending') throw new Error('Proposal is not pending.');
    proposal.status = 'rejected'; proposal.rejectedAt = new Date().toISOString();
    e.store.record('proposal-reject', 'proposal', id, null, proposal, 'human');
    await e.store.save();
    return proposal;
  }
  async exportBundle(format = 'json') { const e = await this.refresh(); return e.exportBundle(format); }
  async diagnostics() {
    const e = this.requireEngine();
    const status = e.syncStatus();
    let integrity = 'not available';
    if (e.store.db) { try { integrity = e.store.db.prepare('PRAGMA quick_check').get()?.quick_check || 'unknown'; } catch (error) { integrity = `error: ${error.message}`; } }
    const fileSize = async file => { try { return (await fs.stat(file)).size; } catch { return 0; } };
    return { appVersion: '1.0.1', nodeVersion: process.versions.node, platform: process.platform, arch: process.arch, database: status.backend, dbPath: e.store.dbFile, jsonMirror: e.store.file, databaseBytes: await fileSize(e.store.dbFile), mirrorBytes: await fileSize(e.store.file), integrity, graph: status, memoryCount: Object.keys(e.store.data.memories).length, pendingMemories: Object.values(e.store.data.memories).filter(m => m.status === 'pending').length, proposalCount: Object.keys(e.store.data.proposals).length, notesCount: Object.keys(e.store.data.notes).length, pinCount: Object.keys(e.store.data.pins).length };
  }
  async createBackup(destinationDirectory) {
    const e = this.requireEngine();
    await fs.mkdir(destinationDirectory, { recursive: true });
    try { e.store.db?.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    await e.store.save();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(destinationDirectory, `graf-${path.basename(this.active.root)}-${stamp}.graf-backup`);
    await fs.cp(e.store.dir, backupPath, { recursive: true, errorOnExist: true });
    return { backupPath };
  }
  async restoreBackup(sourceDirectory) {
    if (!this.active) throw new Error('Open a project before restoring a backup.');
    const manifest = await fs.readdir(sourceDirectory);
    if (!manifest.includes('graph.json') && !manifest.includes('graph.db')) throw new Error('This folder does not look like a Graf backup.');
    const root = this.active.root;
    const target = path.join(root, '.graf');
    const safety = path.join(root, `.graf-before-restore-${Date.now()}`);
    await this.closeActive();
    let moved = false;
    try {
      try { await fs.rename(target, safety); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.cp(sourceDirectory, target, { recursive: true });
      const result = await this.openProject(root, { fullSync: false });
      return { restored: true, safetyBackup: moved ? safety : null, project: result.project, status: result.status };
    } catch (error) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => {});
      if (moved) await fs.rename(safety, target).catch(() => {});
      await this.openProject(root, { fullSync: false }).catch(() => {});
      throw error;
    }
  }
  async getLayout() { const root = this.requireEngine().root; return clone(this.layouts[root] || {}); }
  async saveLayout(layout) {
    const root = this.requireEngine().root;
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw new Error('Layout must be an object.');
    const safe = {};
    for (const [id, p] of Object.entries(layout).slice(0, 4000)) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      safe[id] = { x: Math.max(-100000, Math.min(100000, p.x)), y: Math.max(-100000, Math.min(100000, p.y)) };
    }
    this.layouts[root] = safe;
    const tmp = `${this.layoutFile}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.layouts, null, 2), 'utf8');
    await fs.rename(tmp, this.layoutFile);
    return { saved: Object.keys(safe).length };
  }
  async shutdown() { await this.closeActive(); }
}
