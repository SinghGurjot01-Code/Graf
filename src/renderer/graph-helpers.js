/** Decide whether saved coordinates are complete enough for Cytoscape's preset layout. */
export function chooseInitialGraphLayout(nodes, savedPositions) {
  const list = Array.isArray(nodes) ? nodes : [];
  const positions = savedPositions && typeof savedPositions === 'object' ? savedPositions : {};
  const hasCompleteLayout = list.length > 0 && list.every(node => {
    const point = positions[node.id];
    return point && Number.isFinite(point.x) && Number.isFinite(point.y);
  });
  return { name: hasCompleteLayout ? 'preset' : 'cose', hasCompleteLayout };
}

/** Resolve an impact target from a node ID or a human-readable symbol/path query. */
export async function resolveImpactTarget(query, graphApi) {
  const raw = String(query ?? '').trim();
  if (!raw) return { kind: 'empty' };

  try {
    const node = await graphApi.node(raw);
    if (node?.id) return { kind: 'resolved', id: node.id, node };
  } catch {
    // A non-ID query should continue through the graph's indexed search.
  }

  const matches = await graphApi.search(raw);
  const list = Array.isArray(matches) ? matches : [];
  const lower = raw.toLocaleLowerCase();
  const exact = list.filter(node =>
    String(node.name ?? '').toLocaleLowerCase() === lower ||
    String(node.path ?? '').toLocaleLowerCase() === lower
  );
  const candidates = exact.length ? exact : list;

  if (!candidates.length) return { kind: 'not-found', query: raw };
  if (candidates.length > 1) return { kind: 'choices', query: raw, candidates: candidates.slice(0, 12), total: candidates.length };
  return { kind: 'resolved', id: candidates[0].id, node: candidates[0] };
}
