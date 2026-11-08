/** Pure helpers for the Project Tree page (unit tested, no DOM). */

/** Keep only branches that contain a match. Returns { roots, matches }. */
export function filterTree(roots, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { roots, matches: 0 };
  let matches = 0;
  const prune = node => {
    const self = `${node.name} ${node.path || ''}`.toLowerCase().includes(q);
    const kids = (node.children || []).map(prune).filter(Boolean);
    if (self) matches++;
    if (!self && !kids.length) return null;
    return { ...node, children: self && !kids.length ? node.children || [] : kids };
  };
  return { roots: roots.map(prune).filter(Boolean), matches };
}

/** Ids that should start expanded: every node shallower than `depth`. */
export function expandedToDepth(roots, depth = 2) {
  const out = new Set();
  const walk = (node, level) => { if (level < depth && node.children?.length) { out.add(node.id); node.children.forEach(c => walk(c, level + 1)); } };
  roots.forEach(r => walk(r, 0));
  return out;
}

export function expandAll(roots) {
  const out = new Set();
  const walk = node => { if (node.children?.length) { out.add(node.id); node.children.forEach(walk); } };
  roots.forEach(walk);
  return out;
}

/** Ids of every ancestor of `targetId` (so the node can be revealed), or null if absent. */
export function pathTo(roots, targetId) {
  const walk = (node, trail) => {
    if (node.id === targetId) return trail;
    for (const child of node.children || []) { const hit = walk(child, [...trail, node.id]); if (hit) return hit; }
    return null;
  };
  for (const root of roots) { const hit = walk(root, []); if (hit) return hit; }
  return null;
}

export const isRealNode = id => typeof id === 'string' && !/^(dir|project|group):/.test(id);

/** One-line facts shown on a tree card. */
export function cardFacts(node) {
  const m = node.meta || {};
  if (node.ref) return ['↺ shown above'];
  if (node.kind === 'folder' || node.kind === 'project') return [m.files != null ? `${m.files} file${m.files === 1 ? '' : 's'}` : ''];
  if (node.kind === 'group') return [node.summary];
  if (node.kind === 'file') return [m.lines, m.language, m.imports ? `${m.imports} import${m.imports === 1 ? '' : 's'}` : '', m.importedBy ? `used by ${m.importedBy}` : ''];
  return [m.lines, node.lineStart ? `line ${node.lineStart}` : ''];
}
