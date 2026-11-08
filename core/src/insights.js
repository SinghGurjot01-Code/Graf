import { now, id as makeId } from './utils.js';

/* ==========================================================================
   Tree views and usage accounting for Graf.

   Everything here is local and deterministic: no model calls, so keeping the
   graph fresh costs zero LLM tokens.
   ========================================================================== */

export const ASSUMED_MS_PER_FILE_READ = 1500; // assumption: one agent "open file" round trip
export const MAX_TOKENS_PER_FILE = 8000;      // agents rarely read more than this per file
const MAX_ENTRIES = 3000;
const FOLD_BATCH = 500;

const tokensOf = text => Math.ceil(String(text ?? '').length / 4);
const fileId = p => `file:${p}`;

/* ---------- tree building ---------- */

function countDescendants(node) {
  let n = 0;
  for (const child of node.children || []) n += 1 + countDescendants(child);
  node.count = n;
  return n;
}

function symbolMeta(n) {
  const lines = n.lineStart && n.lineEnd ? `${n.lineEnd - n.lineStart + 1} lines` : '';
  return { lines, signature: n.signature || '', line: n.lineStart || null };
}

function leafFrom(n, extra = {}) {
  return {
    id: n.id, kind: n.kind, name: n.name, path: n.path || null, summary: n.summary || '',
    provenance: n.provenance || 'verified', lineStart: n.lineStart || null, lineEnd: n.lineEnd || null,
    meta: symbolMeta(n), children: [], ...extra
  };
}

/** Project → folders → files → classes → functions. Single-child folder chains are merged (src/main). */
function structureTree(engine) {
  const nodes = engine.activeNodes();
  const edges = Object.values(engine.store.data.edges);
  const importsOut = new Map(), importsIn = new Map();
  for (const e of edges) {
    if (e.type !== 'imports' || !e.dst.startsWith('file:')) continue;
    const src = e.src.startsWith('file:') ? e.src : fileId(engine.store.data.nodes[e.src]?.path || '');
    importsOut.set(src, (importsOut.get(src) || 0) + 1);
    importsIn.set(e.dst, (importsIn.get(e.dst) || 0) + 1);
  }
  const byPath = new Map();
  for (const n of nodes) { if (!n.path) continue; (byPath.get(n.path) || byPath.set(n.path, []).get(n.path)).push(n); }

  const root = { id: 'project:root', kind: 'project', name: engine.store.data.repository.name || 'project', summary: '', meta: {}, children: [] };
  const dirs = new Map([['', root]]);
  const dirNode = dirPath => {
    if (dirs.has(dirPath)) return dirs.get(dirPath);
    const parentPath = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '';
    const node = { id: `dir:${dirPath}`, kind: 'folder', name: dirPath.split('/').pop(), path: dirPath, summary: '', meta: {}, children: [] };
    dirNode(parentPath).children.push(node);
    dirs.set(dirPath, node);
    return node;
  };

  for (const [p, list] of [...byPath.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const file = list.find(n => n.kind === 'file');
    if (!file) continue;
    const fileNode = leafFrom(file, {
      meta: {
        lines: file.lineEnd ? `${file.lineEnd} lines` : '', language: file.language || '',
        imports: importsOut.get(file.id) || 0, importedBy: importsIn.get(file.id) || 0
      }
    });
    const symbols = list.filter(n => n.kind !== 'file').sort((a, b) => (a.lineStart || 0) - (b.lineStart || 0));
    const placed = new Map();
    for (const s of symbols) placed.set(s.qualifiedName || s.name, leafFrom(s));
    for (const s of symbols) {
      const q = s.qualifiedName || s.name;
      const parentKey = q.includes('.') ? q.slice(0, q.lastIndexOf('.')) : null;
      const parent = parentKey ? placed.get(parentKey) : null;
      (parent && parent !== placed.get(q) ? parent : fileNode).children.push(placed.get(q));
    }
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    dirNode(dir).children.push(fileNode);
  }

  const finish = node => {
    node.children.sort((a, b) => (a.kind === 'folder') === (b.kind === 'folder') ? 0 : a.kind === 'folder' ? -1 : 1);
    for (const c of node.children) finish(c);
    if (node.kind === 'folder' || node.kind === 'project') {
      // merge chains of folders that only contain one folder
      while (node.kind === 'folder' && node.children.length === 1 && node.children[0].kind === 'folder') {
        const only = node.children[0];
        node.name = `${node.name}/${only.name}`; node.path = only.path; node.id = only.id; node.children = only.children;
      }
      const files = (function count(n) { return n.kind === 'file' ? 1 : (n.children || []).reduce((s, c) => s + count(c), 0); })(node);
      node.meta = { files };
      node.summary = `${files} file${files === 1 ? '' : 's'}`;
    }
  };
  finish(root);
  countDescendants(root);
  return [root];
}

/** Entry files at the top, each with the files it imports below it. Several trees, not one. */
function dependencyForest(engine, { maxNodes = 1500 } = {}) {
  const data = engine.store.data;
  const out = new Map(), inc = new Map();
  for (const e of Object.values(data.edges)) {
    if (e.type !== 'imports' || !e.dst.startsWith('file:')) continue;
    const src = e.src.startsWith('file:') ? e.src : fileId(data.nodes[e.src]?.path || '');
    if (!data.nodes[src] || data.nodes[src].deletedAt || !data.nodes[e.dst] || data.nodes[e.dst].deletedAt) continue;
    (out.get(src) || out.set(src, new Set()).get(src)).add(e.dst);
    (inc.get(e.dst) || inc.set(e.dst, new Set()).get(e.dst)).add(src);
  }
  const files = engine.activeNodes().filter(n => n.kind === 'file');
  let budget = maxNodes;
  const build = (nid, seen, via) => {
    const n = data.nodes[nid];
    const node = leafFrom(n, { via, meta: { lines: n.lineEnd ? `${n.lineEnd} lines` : '', language: n.language || '', imports: out.get(nid)?.size || 0, importedBy: inc.get(nid)?.size || 0 } });
    if (seen.has(nid)) { node.ref = true; node.summary = 'Already shown above in this tree'; return node; }
    seen.add(nid);
    for (const child of [...(out.get(nid) || [])].sort()) {
      if (budget-- <= 0) { node.truncated = true; break; }
      node.children.push(build(child, seen, 'imports'));
    }
    return node;
  };
  const entries = files.filter(f => out.has(f.id) && !inc.has(f.id)).sort((a, b) => (out.get(b.id).size - out.get(a.id).size) || a.id.localeCompare(b.id));
  const covered = new Set();
  const roots = entries.map(f => { const seen = new Set(); const t = build(f.id, seen, null); seen.forEach(x => covered.add(x)); return t; });
  // import cycles with no entry point: start from whatever is left that has imports
  for (const f of files) {
    if (out.has(f.id) && !covered.has(f.id)) { const seen = new Set(); roots.push(build(f.id, seen, null)); seen.forEach(x => covered.add(x)); }
  }
  const standalone = files.filter(f => !covered.has(f.id)).map(f => leafFrom(f, { meta: { lines: f.lineEnd ? `${f.lineEnd} lines` : '', language: f.language || '', imports: 0, importedBy: 0 } }));
  if (standalone.length) roots.push({ id: 'group:standalone', kind: 'group', name: 'Standalone files', summary: `${standalone.length} file${standalone.length === 1 ? '' : 's'} with no import relationships`, meta: {}, children: standalone });
  roots.forEach(countDescendants);
  return roots;
}

/** Walk outward from one node: what it uses ('out') or what depends on it ('in'). */
function relationTree(engine, nodeId, direction = 'out', depth = 3, maxNodes = 400) {
  const data = engine.store.data;
  const start = data.aliases[nodeId] || nodeId;
  const startNode = data.nodes[start];
  if (!startNode || startNode.deletedAt) throw new Error(`Node not found: ${nodeId}`);
  const edges = Object.values(data.edges).filter(e => e.type !== 'defines');
  const adj = new Map();
  for (const e of edges) {
    const from = direction === 'out' ? e.src : e.dst, to = direction === 'out' ? e.dst : e.src;
    (adj.get(from) || adj.set(from, []).get(from)).push({ to, type: e.type });
  }
  const seen = new Set([start]);
  let budget = maxNodes;
  const build = (nid, level, via) => {
    const n = data.nodes[nid];
    const node = leafFrom(n, { via });
    if (level >= depth) return node;
    for (const next of (adj.get(nid) || []).sort((a, b) => a.to.localeCompare(b.to))) {
      const target = data.nodes[next.to];
      if (!target || target.deletedAt || target.hidden) continue;
      if (seen.has(next.to)) continue;
      if (budget-- <= 0) { node.truncated = true; break; }
      seen.add(next.to);
      node.children.push(build(next.to, level + 1, next.type));
    }
    return node;
  };
  const root = build(start, 0, null);
  countDescendants(root);
  return [root];
}

export function buildTree(engine, { mode = 'structure', id, depth = 3, maxNodes } = {}) {
  let roots;
  if (mode === 'structure') roots = structureTree(engine);
  else if (mode === 'dependencies') roots = id ? relationTree(engine, id, 'out', depth, maxNodes) : dependencyForest(engine, { maxNodes: maxNodes || 1500 });
  else if (mode === 'dependents') { if (!id) throw new Error('dependents mode needs a node id'); roots = relationTree(engine, id, 'in', depth, maxNodes); }
  else throw new Error('mode must be structure, dependencies or dependents');
  const total = roots.reduce((s, r) => s + 1 + r.count, 0);
  return { mode, id: id || null, roots, total };
}

/** Compact indented text for agents: one line per node, IDs only (they already encode kind and path). */
export function treeOutline(tree, { depth = 3, maxNodes = 150 } = {}) {
  const lines = [];
  let shown = 0, truncated = false;
  const walk = (node, level) => {
    if (shown >= maxNodes) { truncated = true; return; }
    shown++;
    const label = node.kind === 'folder' ? `${node.name}/` : node.kind === 'project' || node.kind === 'group' ? node.name : node.id;
    const bits = [];
    if (node.via) bits.push(node.via);
    if (node.meta?.lines && node.kind === 'file') bits.push(node.meta.lines);
    if (node.ref) bits.push('see above');
    if (node.kind === 'file' && node.meta?.importedBy) bits.push(`used by ${node.meta.importedBy}`);
    lines.push(`${'  '.repeat(level)}${label}${bits.length ? ` (${bits.join(', ')})` : ''}`);
    if (level >= depth) { if (node.children.length) lines[lines.length - 1] += ` +${node.count ?? node.children.length}`; return; }
    for (const child of node.children) walk(child, level + 1);
  };
  for (const root of tree.roots) walk(root, 0);
  return { text: lines.join('\n'), nodesShown: shown, truncated: truncated || shown >= maxNodes && tree.total > shown };
}

/* ---------- usage accounting ---------- */

function collectPaths(value, files, out, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return;
  if (Array.isArray(value)) { for (const v of value) collectPaths(v, files, out, depth + 1); return; }
  if (typeof value.path === 'string' && files[value.path]) out.add(value.path);
  for (const v of Object.values(value)) if (v && typeof v === 'object') collectPaths(v, files, out, depth + 1);
}

function fileTokens(engine, p) {
  const node = engine.store.data.nodes[fileId(p)];
  return Math.min(MAX_TOKENS_PER_FILE, Math.ceil((node?.size || 0) / 4));
}

/**
 * Estimate what an agent would have read without Graf for the same question.
 * This is an estimate, labelled as one everywhere it is shown.
 */
export function estimateBaseline(engine, tool, result) {
  const files = engine.store.data.files;
  let paths = [];
  if (tool === 'overview') {
    const count = result?.modules?.length > 12 ? 40 : 25;
    paths = Object.keys(files).sort((a, b) => fileTokens(engine, b) - fileTokens(engine, a)).slice(0, count);
  } else if (['search', 'get_node', 'neighbors', 'impact_of', 'get_context', 'read_node', 'tree'].includes(tool)) {
    const found = new Set(); collectPaths(result, files, found); paths = [...found].slice(0, 15);
  }
  const tokens = paths.reduce((s, p) => s + fileTokens(engine, p), 0);
  return { tokens, files: paths.length };
}

export function recordUsage(engine, entry) {
  const data = engine.store.data;
  data.usage ||= []; data.usageTotals ||= {};
  const item = { id: makeId('use'), ts: now(), source: 'mcp', kind: 'call', ...entry };
  data.usage.push(item);
  if (data.usage.length > MAX_ENTRIES) {
    for (const old of data.usage.splice(0, FOLD_BATCH)) {
      const day = String(old.ts).slice(0, 10);
      const t = data.usageTotals[day] ||= { calls: 0, responseTokens: 0, baselineTokens: 0, ms: 0, estMsWithout: 0 };
      if (old.kind === 'call') { t.calls++; t.responseTokens += old.responseTokens || 0; t.baselineTokens += old.baselineTokens || 0; t.ms += old.ms || 0; t.estMsWithout += old.estMsWithout || 0; }
    }
  }
  return item;
}

export function recordToolCall(engine, { tool, args, result, ms, client }) {
  const responseTokens = tokensOf(JSON.stringify(result));
  const base = estimateBaseline(engine, tool, result);
  const baselineTokens = base.tokens;
  const estMsWithout = base.files * ASSUMED_MS_PER_FILE_READ;
  const query = typeof args?.query === 'string' ? args.query.slice(0, 120) : typeof args?.id === 'string' ? args.id.slice(0, 120) : '';
  return recordUsage(engine, {
    kind: 'call', tool, query, ms: Math.round(ms), responseTokens, baselineTokens,
    savedTokens: Math.max(0, baselineTokens - responseTokens), filesAvoided: base.files, estMsWithout, client: client || null
  });
}

export function recordTaskReport(engine, { task, tokens, durationMs, withGraf = true, notes = '', client }) {
  return recordUsage(engine, {
    kind: 'task', source: 'agent', tool: 'report_usage', task: String(task).slice(0, 200), tokens, ms: durationMs,
    withGraf: !!withGraf, notes: String(notes || '').slice(0, 300), client: client || null
  });
}

export function usageSummary(engine, { days = 14 } = {}) {
  const data = engine.store.data;
  const entries = data.usage || [];
  const calls = entries.filter(e => e.kind === 'call');
  const sum = (list, key) => list.reduce((s, e) => s + (e[key] || 0), 0);
  const folded = Object.values(data.usageTotals || {});
  const foldSum = key => folded.reduce((s, t) => s + (t[key] || 0), 0);

  const totalCalls = calls.length + foldSum('calls');
  const responseTokens = sum(calls, 'responseTokens') + foldSum('responseTokens');
  const baselineTokens = sum(calls, 'baselineTokens') + foldSum('baselineTokens');
  const savedTokens = sum(calls, 'savedTokens') + Math.max(0, foldSum('baselineTokens') - foldSum('responseTokens'));
  const measuredMs = sum(calls, 'ms') + foldSum('ms');
  const estMsWithout = sum(calls, 'estMsWithout') + foldSum('estMsWithout');

  const byTool = {};
  for (const c of calls) {
    const t = byTool[c.tool] ||= { tool: c.tool, calls: 0, responseTokens: 0, baselineTokens: 0, ms: 0 };
    t.calls++; t.responseTokens += c.responseTokens || 0; t.baselineTokens += c.baselineTokens || 0; t.ms += c.ms || 0;
  }
  const byDay = new Map();
  for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); byDay.set(d, { day: d, calls: 0, responseTokens: 0, baselineTokens: 0 }); }
  for (const c of calls) { const d = byDay.get(String(c.ts).slice(0, 10)); if (d) { d.calls++; d.responseTokens += c.responseTokens || 0; d.baselineTokens += c.baselineTokens || 0; } }
  for (const [day, t] of Object.entries(data.usageTotals || {})) { const d = byDay.get(day); if (d) { d.calls += t.calls; d.responseTokens += t.responseTokens; d.baselineTokens += t.baselineTokens; } }

  const tasks = entries.filter(e => e.kind === 'task');
  const avg = list => ({ n: list.length, avgTokens: list.length ? Math.round(sum(list, 'tokens') / list.length) : 0, avgMs: list.length ? Math.round(sum(list, 'ms') / list.length) : 0 });
  const syncs = entries.filter(e => e.kind === 'sync');

  return {
    totals: {
      calls: totalCalls, responseTokens, baselineTokens, savedTokens,
      savedPct: baselineTokens ? Math.round((savedTokens / baselineTokens) * 100) : 0,
      measuredMs, estMsWithout, savedMs: Math.max(0, estMsWithout - measuredMs),
      avgResponseTokens: totalCalls ? Math.round(responseTokens / totalCalls) : 0,
      avgMs: calls.length ? Math.round(sum(calls, 'ms') / calls.length) : 0
    },
    byTool: Object.values(byTool).sort((a, b) => b.calls - a.calls),
    byDay: [...byDay.values()],
    recent: entries.filter(e => e.kind === 'call').slice(-25).reverse(),
    tasks: { withGraf: avg(tasks.filter(t => t.withGraf)), without: avg(tasks.filter(t => !t.withGraf)), recent: tasks.slice(-10).reverse() },
    graphUpdates: { syncs: syncs.length, filesIndexed: sum(syncs, 'files'), totalMs: sum(syncs, 'ms'), llmTokens: 0, last: syncs.at(-1)?.ts || null },
    assumptions: { msPerFileRead: ASSUMED_MS_PER_FILE_READ, maxTokensPerFile: MAX_TOKENS_PER_FILE, tokenEstimate: 'characters / 4' }
  };
}

export function clearUsage(engine) {
  const n = (engine.store.data.usage || []).length;
  engine.store.data.usage = []; engine.store.data.usageTotals = {};
  return { cleared: n };
}
