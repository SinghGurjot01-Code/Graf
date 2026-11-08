import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseInitialGraphLayout, resolveImpactTarget } from '../src/renderer/graph-helpers.js';

test('graph uses saved positions only when every visible node has valid coordinates', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(chooseInitialGraphLayout(nodes, { a: { x: 10, y: 20 }, b: { x: -5, y: 9 } }), { name: 'preset', hasCompleteLayout: true });
  assert.deepEqual(chooseInitialGraphLayout(nodes, { a: { x: 10, y: 20 } }), { name: 'cose', hasCompleteLayout: false });
  assert.deepEqual(chooseInitialGraphLayout(nodes, { a: { x: '10', y: 20 }, b: { x: 0, y: 0 } }), { name: 'cose', hasCompleteLayout: false });
  assert.deepEqual(chooseInitialGraphLayout([], {}), { name: 'cose', hasCompleteLayout: false });
});

test('impact target resolves a direct node ID without performing a search', async () => {
  let searched = false;
  const node = { id: 'function:app.js#start', name: 'start' };
  const result = await resolveImpactTarget(node.id, {
    node: async id => ({ ...node, id }),
    search: async () => { searched = true; return []; }
  });
  assert.equal(result.kind, 'resolved');
  assert.equal(result.id, node.id);
  assert.equal(searched, false);
});

test('impact target resolves a unique symbol name from graph search', async () => {
  const node = { id: 'function:app.js#start', name: 'start', kind: 'function' };
  const result = await resolveImpactTarget('start', {
    node: async () => { throw new Error('not a node ID'); },
    search: async query => query === 'start' ? [node] : []
  });
  assert.equal(result.kind, 'resolved');
  assert.equal(result.id, node.id);
});

test('impact target returns choices for ambiguous names and handles no matches', async () => {
  const matches = [
    { id: 'function:a.js#open', name: 'open', path: 'a.js', kind: 'function' },
    { id: 'function:b.js#open', name: 'open', path: 'b.js', kind: 'function' }
  ];
  const graph = { node: async () => { throw new Error('not a node ID'); }, search: async () => matches };
  const choices = await resolveImpactTarget('open', graph);
  assert.equal(choices.kind, 'choices');
  assert.equal(choices.total, 2);
  assert.equal(choices.candidates.length, 2);
  const none = await resolveImpactTarget('missing', { ...graph, search: async () => [] });
  assert.equal(none.kind, 'not-found');
});

// Renderer source guardrails: these behaviors were previously absent despite the Core tests passing.
test('renderer provides project/settings navigation before a project is open', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
  assert.match(source, /if \(page === 'projects'\)[\s\S]*?await renderProjects\(\)/);
  assert.match(source, /if \(page === 'settings'\)[\s\S]*?await renderSettings\(\)/);
  assert.match(source, /setProjectNavigationEnabled\(false\)/);
});

test('modal cancellation resolves pending renderer actions on Escape and close button', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
  assert.match(source, /addEventListener\('cancel',[\s\S]*?cancelActiveModal\(\)/);
  assert.match(source, /activeModalCancel = finish/);
  const html = await readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  assert.match(html, /type="button" class="icon-button" data-action="modal-cancel"/);
});

test('overview page formats project root path to avoid exposing user home directory', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
  assert.match(source, /formatDisplayPath\(overview\.root \|\| activeProject\.path\)/);
});

test('overview mini graph optimizes edge styles, preset layout, and pointer events', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
  assert.match(source, /curve-style': mini \? 'haystack' : 'bezier'/);
  assert.match(source, /chooseInitialGraphLayout\(graph\.nodes, savedLayout\)/);
  assert.match(source, /autoungrabify: true/);
  const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.graph-preview canvas\s*\{\s*pointer-events:\s*none\s*!important;\s*\}/);
});
