import { chooseInitialGraphLayout, resolveImpactTarget } from './graph-helpers.js';
import { icon, kindInfo, KIND } from './icons.js';
import { highlightLines } from './highlight.js';
import { filterTree, expandedToDepth, expandAll, pathTo, isRealNode, cardFacts } from './tree-helpers.js';

/* ==========================================================================
   Helpers
   ========================================================================== */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = value => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const number = value => new Intl.NumberFormat().format(Number(value || 0));
const cap = s => String(s ?? '').charAt(0).toUpperCase() + String(s ?? '').slice(1);
const shortId = (id, n = 34) => { const s = String(id ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function timeAgo(value) {
  if (!value) return '—';
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return fmtDate(value);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const area = document.createElement('textarea');
    area.value = text; area.style.cssText = 'position:fixed;opacity:0;left:-9999px';
    document.body.append(area); area.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    area.remove(); return ok;
  }
}
const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
};

let homeDirPath = '';
function formatDisplayPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  if (!homeDirPath) return rawPath;
  const p = rawPath.trim();
  const h = homeDirPath.trim();
  if (p.toLowerCase() === h.toLowerCase()) return '~';
  const pNorm = p.replace(/\\/g, '/');
  const hNorm = h.replace(/\\/g, '/');
  if (pNorm.toLowerCase().startsWith(hNorm.toLowerCase() + '/')) {
    const rel = pNorm.slice(hNorm.length + 1);
    return rawPath.includes('\\') ? `~\\${rel.replace(/\//g, '\\')}` : `~/${rel}`;
  }
  return rawPath;
}

/* ==========================================================================
   State
   ========================================================================== */
const PAGES = {
  overview: { title: 'Overview', icon: 'overview', key: 'Ctrl 1', group: 'WORKSPACE' },
  integrations: { title: 'Integrations', icon: 'integrations', group: 'WORKSPACE', always: true },
  tree: { title: 'Project Tree', icon: 'tree', key: 'Ctrl 2', group: 'WORKSPACE', fill: true },
  usage: { title: 'Usage & Savings', icon: 'chart', key: 'Ctrl 3', group: 'WORKSPACE' },
  projects: { title: 'Projects', icon: 'projects', group: 'WORKSPACE', always: true },
  settings: { title: 'Settings', icon: 'settings', group: 'SYSTEM', always: true },
  graph: { title: 'Graph Explorer', icon: 'graph', key: 'Ctrl 4', group: 'WORKSPACE', fill: true },
  explorer: { title: 'Code Explorer', icon: 'explorer', group: 'COMING SOON', soon: true, blurb: 'Browse and read indexed source files.' },
  search: { title: 'Search', icon: 'search', group: 'COMING SOON', soon: true, blurb: 'Search files, symbols and memories.' },
  impact: { title: 'Impact Analysis', icon: 'impact', group: 'COMING SOON', soon: true, blurb: 'See what breaks when a symbol changes.' },
  context: { title: 'Context Studio', icon: 'context', group: 'COMING SOON', soon: true, blurb: 'Build a token-budgeted context pack for a task.' },
  memory: { title: 'Memory', icon: 'memory', group: 'COMING SOON', soon: true, blurb: 'Project memories written by you and your agents.' },
  history: { title: 'History', icon: 'history', group: 'COMING SOON', soon: true, blurb: 'Snapshots, diffs and restore.' },
  proposals: { title: 'Proposals', icon: 'proposals', group: 'COMING SOON', soon: true, blurb: 'Review changes proposed by agents.' },
  diagnostics: { title: 'Diagnostics', icon: 'diagnostics', group: 'COMING SOON', soon: true, blurb: 'Health checks, backup and export.' }
};
let activePage = 'overview';
let activeProject = null;
let lastStatus = null;
let selectedNode = null;
let cy = null;
let miniCy = null;
/** Read-only probe used by the end-to-end tests to verify the graph really rendered and reacted. */
window.grafDebug = {
  graph: () => cy ? { total: cy.nodes().length, visible: cy.nodes(':visible').length, faded: cy.nodes('.faded').length, edges: cy.edges().length, selected: cy.$(':selected').map(n => n.id()), spread: (() => { const xs = cy.nodes().map(n => Math.round(n.position('x'))); return new Set(xs).size; })(), first: cy.nodes().slice(0, 3).map(n => [Math.round(n.position('x')), Math.round(n.position('y'))]) } : null,
  tap: id => { const n = cy?.getElementById(id); if (n?.nonempty()) { n.emit('tap'); return true; } return false; },
  firstNodeId: kind => cy?.nodes().filter(n => !kind || n.data('kind') === kind).first()?.id() || null
};
let navSeq = 0;
let activeModalCancel = null;
let syncInProgress = false;
let currentFiles = [];
let memoryTab = 'all';
let memoryQuery = '';
let proposalTab = 'pending';
let settingsTab = 'general';
let appPreferences = { closeToTray: false, login: {} };
let currentSourcePath = null;
let lastContext = null;
let graphCache = null;
let searchKind = '';
let searchSeq = 0;
let pendingSearch = null;
let pendingImpact = null;
let graphHasCompleteLayout = false;
const PENDING = { memories: 0, proposals: 0 };

/* ==========================================================================
   Small UI building blocks
   ========================================================================== */
function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.innerHTML = `${icon(type === 'error' ? 'error' : type === 'info' ? 'info' : 'ok', 17)}<span>${escapeHtml(message)}</span>`;
  const region = $('#toastRegion');
  while (region.children.length >= 4) region.firstElementChild.remove();
  const dismiss = () => { item.classList.add('leaving'); setTimeout(() => item.remove(), 220); };
  item.addEventListener('click', dismiss);
  region.append(item);
  setTimeout(dismiss, type === 'error' ? 7000 : 4000);
}
function setLoading(loading, label = 'Working…') {
  $('#appShell').classList.toggle('is-loading', loading);
  $('#engineDot').className = `status-dot ${loading ? 'warning' : 'online'}`;
  $('#engineStateText').textContent = loading ? label : 'Engine ready';
}
/** Button factory. opts: v = primary|secondary|ghost|danger, i = icon, s = small, a = raw attrs, t = title, d = disabled */
function btn(label, action, opts = {}) {
  const cls = ['button', opts.v && opts.v !== 'secondary' ? `button-${opts.v}` : '', opts.s ? 'button-small' : ''].filter(Boolean).join(' ');
  return `<button type="button" class="${cls}" data-action="${action}" ${opts.a || ''} ${opts.t ? `title="${escapeHtml(opts.t)}"` : ''} ${opts.d ? 'disabled' : ''}>${opts.i ? icon(opts.i, opts.s ? 14 : 16) : ''}${label ? `<span>${label}</span>` : ''}</button>`;
}
const iconBtn = (name, action, label, attrs = '') => `<button type="button" class="icon-button" data-action="${action}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ${attrs}>${icon(name, 16)}</button>`;
function emptyState(iconName, title, text = '', actionHtml = '') {
  return `<div class="empty-state"><div class="es-icon">${icon(iconName, 20)}</div><strong>${escapeHtml(title)}</strong>${text ? `<p>${escapeHtml(text)}</p>` : ''}${actionHtml}</div>`;
}
function pageHead(title, subtitle, actions = '', meta = '') {
  return `<div class="page-head"><div><div class="eyebrow">${escapeHtml(activeProject?.name || 'Graf')}</div><h1 class="page-title">${title}</h1>${subtitle ? `<p class="page-subtitle">${subtitle}</p>` : ''}${meta ? `<div class="head-meta">${meta}</div>` : ''}</div><div class="head-actions">${actions}</div></div>`;
}
const kindDot = kind => `<i class="kind-dot" style="background:${kindInfo(kind).color}"></i>`;
const kindTag = kind => `<span class="result-kind">${escapeHtml(kindInfo(kind).label)}</span>`;
const kindIcon = (kind, size = 16) => { const k = kindInfo(kind); return `<span style="color:${k.color};display:grid">${icon(k.icon, size)}</span>`; };
const statusTag = status => {
  const cls = { active: 'success', approved: 'success', pending: 'warning', archived: '', rejected: 'danger', deleted: 'danger' }[status] ?? '';
  return `<span class="tag ${cls}">${escapeHtml(cap(status))}</span>`;
};
const langColor = lang => ({ javascript: '#e6c27a', typescript: '#8fb4f0', python: '#7fd1a1', java: '#f0908f', yaml: '#c3a9f2', dotenv: '#a9d68f', json: '#f0b97d' })[lang] || '#6d727d';

function mountStaticIcons() {
  $('#sidebarCollapse').innerHTML = icon('left', 16);
  $('#projectChevron').innerHTML = icon('down', 14);
  $('#addProjectFromPopover').innerHTML = `${icon('plus', 15)}<span>Add project</span>`;
  $('#footerLock').innerHTML = icon('lock', 13);
  $('#searchTriggerIcon').innerHTML = icon('search', 15);
  $('#quickSync').innerHTML = icon('sync', 16);
  $('#branchIcon').innerHTML = icon('branch', 13);
  $('#paletteIcon').innerHTML = icon('search', 18);
  $('[data-action="modal-cancel"]').innerHTML = icon('x', 16);
}
function renderNav() {
  const groups = {};
  for (const [id, p] of Object.entries(PAGES)) (groups[p.group] ||= []).push([id, p]);
  $('#nav').innerHTML = Object.entries(groups).map(([group, items]) => `<div class="nav-group"><div class="nav-label">${group}</div>${items.map(([id, p]) => `<button type="button" class="nav-item${p.soon ? ' is-soon' : ''}" data-page="${id}" title="${escapeHtml(p.soon ? p.title + ' — coming soon' : p.title)}" ${p.soon ? 'disabled' : ''}>${icon(p.icon, 17)}<span class="nav-text">${p.title}</span>${p.soon ? '<span class="soon-pill">Soon</span>' : p.key ? `<kbd>${p.key}</kbd>` : ''}</button>`).join('')}</div>`).join('');
}
function updateNav() {
  $$('.nav-item').forEach(item => { const on = item.dataset.page === activePage; item.classList.toggle('active', on); if (on) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); });
  $('#breadcrumbCurrent').textContent = PAGES[activePage]?.title || 'Overview';
}
function destroyGraphs() {
  if (cy) { try { cy.destroy(); } catch {} cy = null; }
  if (miniCy) { try { miniCy.destroy(); } catch {} miniCy = null; }
}
/** Replace the page body. Returns false when a newer navigation has superseded this render. */
function showPageContent(html, seq) {
  if (seq !== undefined && seq !== navSeq) return false;
  // A detached Cytoscape canvas still owns observers, event handlers and layout timers.
  // Destroy it before replacing page markup so navigation does not leak graph instances.
  destroyGraphs();
  $('#welcomeState').classList.add('hidden');
  const content = $('#pageContent');
  content.classList.remove('hidden');
  content.style.animation = 'none'; void content.offsetHeight; content.style.animation = '';
  content.innerHTML = html;
  $('#workspace').classList.toggle('is-fill', Boolean(PAGES[activePage]?.fill));
  $('#workspace').scrollTop = 0;
  return true;
}
function setProjectNavigationEnabled(enabled) {
  $$('.nav-item').forEach(item => {
    const soon = PAGES[item.dataset.page]?.soon;
    const allowed = !soon && (enabled || PAGES[item.dataset.page]?.always);
    item.disabled = !allowed;
    item.title = soon ? `${PAGES[item.dataset.page].title} — coming soon` : allowed ? PAGES[item.dataset.page].title : 'Open a project to use this workspace';
  });
  $('#quickSync').disabled = !enabled;
}

/* ==========================================================================
   Modals (promise based). Escape / close button always resolve the pending action.
   ========================================================================== */
function openModal({ eyebrow = 'GRAF', title, body, actions }) {
  activeModalCancel = null;
  $('#modalEyebrow').textContent = eyebrow;
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modalActions').innerHTML = actions;
  $('#globalModal').showModal();
}
function closeModal() {
  const dialog = $('#globalModal');
  if (dialog.open) dialog.close();
  activeModalCancel = null;
}
function cancelActiveModal() {
  if (activeModalCancel) activeModalCancel(null);
  else closeModal();
}
$('#globalModal form').addEventListener('submit', event => event.preventDefault());
$('#globalModal').addEventListener('cancel', event => {
  event.preventDefault();
  cancelActiveModal();
});
$('#globalModal').addEventListener('mousedown', event => { if (event.target === event.currentTarget) cancelActiveModal(); });

/** Shared promise plumbing for every dialog so cancel/Escape always settle the caller. */
function modalPromise(config, wire) {
  return new Promise(resolve => {
    openModal(config);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      if (activeModalCancel === finish) activeModalCancel = null;
      closeModal();
      resolve(value);
    };
    activeModalCancel = finish;
    wire(finish);
  });
}
function askText({ title, label, placeholder = '', confirm = 'Save', value = '', eyebrow = 'GRAF', multiline = false }) {
  return modalPromise({
    eyebrow, title,
    body: `<div class="field"><label for="modalInput">${escapeHtml(label)}</label>${multiline ? `<textarea id="modalInput" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>` : `<input id="modalInput" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">`}</div>`,
    actions: `<button type="button" class="button button-ghost" data-action="modal-cancel">Cancel</button><button type="button" class="button button-primary" id="modalConfirm">${escapeHtml(confirm)}</button>`
  }, finish => {
    const input = $('#modalInput');
    $('#modalConfirm').onclick = () => finish(input.value.trim());
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !multiline) { event.preventDefault(); finish(input.value.trim()); } });
    requestAnimationFrame(() => { input.focus(); input.select?.(); });
  });
}
/** In-app confirmation. Replaces window.confirm(), which steals focus from inputs on Windows. */
function askConfirm({ title, message, detail = '', confirm = 'Confirm', danger = false }) {
  return modalPromise({
    eyebrow: danger ? 'PLEASE CONFIRM' : 'CONFIRM', title,
    body: `<p>${escapeHtml(message)}</p>${detail ? `<div class="modal-path">${escapeHtml(detail)}</div>` : ''}`,
    actions: `<button type="button" class="button button-ghost" data-action="modal-cancel">Cancel</button><button type="button" class="button ${danger ? 'button-danger' : 'button-primary'}" id="modalConfirm">${escapeHtml(confirm)}</button>`
  }, finish => {
    $('#modalConfirm').onclick = () => finish(true);
    requestAnimationFrame(() => $('#modalConfirm')?.focus());
  }).then(Boolean);
}
function askMemoryForm({ title = '', content = '', linkedNodes = [] } = {}) {
  return modalPromise({
    eyebrow: 'PROJECT KNOWLEDGE', title: title ? 'Edit memory' : 'Add memory',
    body: `<div class="field"><label for="memoryTitleInput">Title</label><input id="memoryTitleInput" maxlength="160" value="${escapeHtml(title)}" placeholder="A decision or project fact"></div><div class="field"><label for="memoryContentInput">Memory</label><textarea id="memoryContentInput" rows="5" maxlength="4000" placeholder="What should Graf remember?">${escapeHtml(content)}</textarea></div><div class="field"><label for="memoryLinksInput">Linked node IDs <span class="small-muted">(comma-separated, optional)</span></label><input id="memoryLinksInput" value="${escapeHtml(linkedNodes.join(', '))}" placeholder="function:src/app.js#boot"></div><div class="banner info" style="margin:0">${icon('info', 16)}<span>Memories you create are active immediately. Agent memories stay pending until a human approves them.</span></div>`,
    actions: `<button type="button" class="button button-ghost" data-action="modal-cancel">Cancel</button><button type="button" class="button button-primary" id="memorySaveButton">Save memory</button>`
  }, finish => {
    $('#memorySaveButton').onclick = () => {
      const nextTitle = $('#memoryTitleInput').value.trim(); const nextContent = $('#memoryContentInput').value.trim();
      if (!nextTitle || !nextContent) return toast('A title and memory text are required.', 'error');
      finish({ title: nextTitle, content: nextContent, linkedNodes: $('#memoryLinksInput').value.split(',').map(x => x.trim()).filter(Boolean) });
    };
    requestAnimationFrame(() => $('#memoryTitleInput')?.focus());
  });
}
function askEdgeForm() {
  return modalPromise({
    eyebrow: 'GRAPH', title: 'Add relationship',
    body: `<div class="field"><label for="edgeSrc">Source node ID</label><input id="edgeSrc" placeholder="file:src/index.js" value="${escapeHtml(selectedNode || '')}"></div><div class="field"><label for="edgeDst">Target node ID</label><input id="edgeDst" placeholder="function:src/index.js#main"></div><div class="field"><label for="edgeType">Relationship type</label><input id="edgeType" value="custom" placeholder="custom"><small>Human-created relationships are marked manual and can be removed later. Source-derived edges are never changed.</small></div>`,
    actions: `<button type="button" class="button button-ghost" data-action="modal-cancel">Cancel</button><button type="button" class="button button-primary" id="edgeSave">Add relationship</button>`
  }, finish => {
    $('#edgeSave').onclick = () => {
      const src = $('#edgeSrc').value.trim(); const dst = $('#edgeDst').value.trim(); const type = $('#edgeType').value.trim() || 'custom';
      if (!src || !dst) return toast('Source and target node IDs are required.', 'error');
      finish({ src, dst, type });
    };
    requestAnimationFrame(() => ($('#edgeSrc').value ? $('#edgeDst') : $('#edgeSrc')).focus());
  });
}
function askNodeForm() {
  return modalPromise({
    eyebrow: 'GRAPH', title: 'Add note node',
    body: `<div class="field"><label for="nodeName">Title</label><input id="nodeName" placeholder="Authentication decision" maxlength="120"></div><div class="field"><label for="nodeSummary">Context or decision</label><textarea id="nodeSummary" placeholder="Why this is important" rows="4"></textarea></div>`,
    actions: `<button type="button" class="button button-ghost" data-action="modal-cancel">Cancel</button><button type="button" class="button button-primary" id="nodeSave">Create node</button>`
  }, finish => {
    $('#nodeSave').onclick = () => {
      const name = $('#nodeName').value.trim();
      if (!name) return toast('A title is required.', 'error');
      finish({ name, summary: $('#nodeSummary').value.trim() });
    };
    requestAnimationFrame(() => $('#nodeName')?.focus());
  });
}

/* ==========================================================================
   Command palette (Ctrl K / Ctrl Shift P)
   ========================================================================== */
let paletteItems = [];
let paletteIndex = 0;
let paletteSeq = 0;
let paletteTimer = null;
function paletteCommands() {
  const enabled = Boolean(activeProject);
  const go = Object.entries(PAGES).filter(([, p]) => !p.soon && (enabled || p.always)).map(([id, p]) => ({ group: 'Go to', label: p.title, hint: p.key || '', icon: p.icon, run: () => navigate(id) }));
  const acts = [
    { group: 'Actions', label: 'Add project…', icon: 'plus', run: () => actions['add-project']() },
    ...(enabled ? [
      { group: 'Actions', label: 'Synchronize project', icon: 'sync', run: () => syncProject(false) },
      { group: 'Actions', label: 'Full rebuild of the graph', icon: 'restore', run: () => actions['rebuild-graph']() },
      { group: 'Actions', label: 'Open project tree', icon: 'tree', run: () => navigate('tree') }
    ] : []),
    { group: 'Actions', label: 'Toggle sidebar', hint: 'Ctrl B', icon: 'sidebar', run: () => toggleSidebar() }
  ];
  return [...go, ...acts];
}
async function renderPalette() {
  const q = $('#paletteInput').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const commands = paletteCommands().filter(c => words.every(w => c.label.toLowerCase().includes(w)));
  paletteItems = commands.slice(0, 14);
  const seq = ++paletteSeq;
  drawPalette();
  clearTimeout(paletteTimer);
  if (activeProject && q.length >= 2) {
    paletteTimer = setTimeout(async () => {
      try {
        const nodes = (await window.graf.graph.search($('#paletteInput').value.trim())).slice(0, 8);
        if (seq !== paletteSeq) return;
        const results = nodes.map(n => ({ group: 'Code', label: n.name || n.id, sub: n.path || n.id, kind: n.kind, run: () => actions['inspect-node']({ id: n.id }) }));
        paletteItems = [...results, ...paletteItems.filter(i => i.group !== 'Search')];
        if (paletteIndex >= paletteItems.length) paletteIndex = 0;
        drawPalette();
      } catch { /* palette search is best-effort */ }
    }, 130);
  }
}
function drawPalette() {
  if (paletteIndex >= paletteItems.length) paletteIndex = Math.max(0, paletteItems.length - 1);
  let lastGroup = '';
  const html = paletteItems.map((item, i) => {
    const head = item.group !== lastGroup ? `<div class="palette-group">${escapeHtml(item.group)}</div>` : '';
    lastGroup = item.group;
    const ic = item.kind ? kindIcon(item.kind, 15) : icon(item.icon || 'hash', 15);
    return `${head}<button type="button" class="palette-item" role="option" data-palette="${i}" aria-selected="${i === paletteIndex}"><span class="pi-icon">${ic}</span><span class="pi-copy"><b>${escapeHtml(item.label)}</b>${item.sub ? `<small>${escapeHtml(item.sub)}</small>` : ''}</span>${item.hint ? `<kbd>${escapeHtml(item.hint)}</kbd>` : ''}</button>`;
  }).join('');
  $('#paletteList').innerHTML = html || `<div class="palette-empty">No matching commands${activeProject ? '' : ' — open a project to search its graph'}.</div>`;
  $('#paletteList').querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}
function openPalette(prefill = '') {
  const dialog = $('#palette');
  if (dialog.open) return;
  if ($('#globalModal').open) return;
  paletteIndex = 0;
  dialog.showModal();
  $('#paletteInput').value = prefill;
  renderPalette();
  requestAnimationFrame(() => $('#paletteInput').focus());
}
function closePalette() { const d = $('#palette'); if (d.open) d.close(); }
async function runPaletteItem(i) {
  const item = paletteItems[i]; if (!item) return;
  closePalette();
  try { await item.run(); } catch (error) { toast(error.message, 'error'); }
}
$('#paletteInput').addEventListener('input', () => { paletteIndex = 0; renderPalette(); });
$('#paletteInput').addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') { event.preventDefault(); paletteIndex = (paletteIndex + 1) % Math.max(1, paletteItems.length); drawPalette(); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); paletteIndex = (paletteIndex - 1 + paletteItems.length) % Math.max(1, paletteItems.length); drawPalette(); }
  else if (event.key === 'Enter') { event.preventDefault(); runPaletteItem(paletteIndex); }
});
$('#paletteList').addEventListener('click', event => { const el = event.target.closest('[data-palette]'); if (el) runPaletteItem(Number(el.dataset.palette)); });
$('#paletteList').addEventListener('mousemove', event => { const el = event.target.closest('[data-palette]'); if (el && Number(el.dataset.palette) !== paletteIndex) { paletteIndex = Number(el.dataset.palette); $$('.palette-item').forEach((n, i) => n.setAttribute('aria-selected', i === paletteIndex)); } });
$('#palette').addEventListener('mousedown', event => { if (event.target === event.currentTarget) closePalette(); });

/* ==========================================================================
   Project state & navigation
   ========================================================================== */
function toggleSidebar(force) {
  const shell = $('#appShell');
  const collapsed = force ?? !shell.classList.contains('sidebar-collapsed');
  shell.classList.toggle('sidebar-collapsed', collapsed);
  $('#sidebarCollapse').setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  store.set('sidebarCollapsed', collapsed);
  closeProjectPopover();
  setTimeout(() => { cy?.resize(); miniCy?.resize(); }, 260);
}
function closeProjectPopover() {
  $('#projectPopover').classList.add('hidden');
  $('#projectSwitcher').setAttribute('aria-expanded', 'false');
}
const projectOptionHtml = (p, activePath) => `<button type="button" class="project-option ${p.path === activePath ? 'active' : ''}" data-action="open-project" data-path="${escapeHtml(p.path)}" role="menuitem"><span class="project-avatar">${escapeHtml((p.name || '?')[0])}</span><span class="po-copy"><b>${escapeHtml(p.name)}</b><small title="${escapeHtml(p.path)}">${p.exists === false ? 'Folder missing · ' : ''}${escapeHtml(formatDisplayPath(p.path))}</small></span>${p.path === activePath ? icon('check', 15) : ''}</button>`;
async function refreshProjects() {
  const projects = await window.graf.projects.list();
  const sorted = [...projects].sort((a, b) => String(b.lastOpenedAt || '').localeCompare(String(a.lastOpenedAt || '')));
  $('#projectList').innerHTML = sorted.map(p => projectOptionHtml(p, activeProject?.path)).join('') || '<div class="small-muted" style="padding:8px 10px">No projects yet</div>';
  return projects;
}
function applyStatus(status) {
  lastStatus = status;
  if (!status) return;
  const stale = status.staleFiles || 0;
  $('#syncDot').className = `status-dot ${stale ? 'warning' : 'online'}`;
  $('#syncLabel').textContent = stale ? `${number(stale)} stale file${stale === 1 ? '' : 's'}` : 'Graph synchronized';
  $('#branchLabel').textContent = status.branch || 'No Git branch';
  $('#fileCountLabel').textContent = `${number(status.files)} files`;
  $('#nodeCountLabel').textContent = `${number(status.nodes)} nodes`;
  $('#edgeCountLabel').textContent = `${number(status.edges)} edges`;
}
function applyProjectChrome() {
  $('#activeProjectName').textContent = activeProject?.name || 'No project selected';
  $('#activeProjectPath').textContent = formatDisplayPath(activeProject?.path) || 'Choose a local repository';
  $('#activeProjectPath').title = activeProject?.path || '';
  $('#projectAvatar').textContent = (activeProject?.name || 'G')[0];
  setProjectNavigationEnabled(Boolean(activeProject));
  document.title = activeProject ? `${activeProject.name} — Graf` : 'Graf';
}
async function updateStatus() {
  if (!activeProject) return;
  applyStatus(await window.graf.project.status());
  await updatePending();
}
async function updatePending() {
  if (!activeProject) return;
  const [memories, proposals] = await Promise.all([window.graf.memory.list().catch(() => []), window.graf.proposals.list().catch(() => [])]);
  PENDING.memories = memories.filter(m => m.status === 'pending').length;
  PENDING.proposals = proposals.filter(p => p.status === 'pending').length;
  for (const [id, n] of [['pendingMemoryCount', PENDING.memories], ['pendingProposalCount', PENDING.proposals]]) {
    const el = document.getElementById(id); if (!el) continue;
    el.textContent = n; el.classList.toggle('zero', n === 0);
  }
}
async function getGraph(force = false) {
  if (!graphCache || force) graphCache = await window.graf.graph.data({ limit: 1800 });
  return graphCache;
}
async function showWelcome() {
  destroyGraphs();
  activeProject = null; selectedNode = null; graphCache = null;
  applyProjectChrome(); setProjectNavigationEnabled(false);
  $('#pageContent').classList.add('hidden');
  $('#workspace').classList.remove('is-fill');
  const projects = (await window.graf.projects.list().catch(() => [])).sort((a, b) => String(b.lastOpenedAt || '').localeCompare(String(a.lastOpenedAt || ''))).slice(0, 4);
  const welcome = $('#welcomeState');
  welcome.classList.remove('hidden');
  welcome.innerHTML = `<div class="welcome-art"><img src="../../assets/brand/Logo.png" alt="Graf"></div><div class="eyebrow">LOCAL-FIRST PROJECT INTELLIGENCE</div><h1>Your codebase<br><span>has a memory now.</span></h1><p>Build a persistent, structured understanding of your project. Explore relationships, inspect impact and give your AI agents precise context.</p><div class="welcome-actions">${btn('Add your first project', 'add-project', { v: 'primary', i: 'plus' })}${btn('Check integrations', 'nav-integrations', { i: 'integrations' })}</div>${projects.length ? `<div class="welcome-recent"><div class="section-label">RECENT PROJECTS</div>${projects.map(p => projectOptionHtml(p, null)).join('')}</div>` : ''}<div class="welcome-trust"><span>${icon('lock', 15)}Local-first</span><span>${icon('integrations', 15)}MCP native</span><span>${icon('shield', 15)}No telemetry</span></div>`;
  $('#syncDot').className = 'status-dot'; $('#syncLabel').textContent = 'No project open'; $('#branchLabel').textContent = 'No branch';
  for (const id of ['fileCountLabel', 'nodeCountLabel', 'edgeCountLabel']) $('#' + id).textContent = id.startsWith('file') ? '0 files' : id.startsWith('node') ? '0 nodes' : '0 edges';
  updateNav();
}
async function openProject(projectPath, { fullSync = false } = {}) {
  setLoading(true, fullSync ? 'Rebuilding graph…' : 'Indexing project…');
  try {
    const result = await window.graf.projects.open(projectPath, { fullSync });
    usageScope = 'project'; activeProject = result.project; graphCache = null; selectedNode = null; currentSourcePath = null; currentFiles = [];
    applyProjectChrome(); applyStatus(result.status);
    await refreshProjects(); await updatePending();
    await navigate('overview');
    return true;
  } catch (error) {
    toast(error.message, 'error');
    await refreshProjects().catch(() => {});
    if (!activeProject) await showWelcome();
    return false;
  } finally { setLoading(false); }
}
async function syncProject(full = false) {
  if (!activeProject || syncInProgress) return;
  syncInProgress = true;
  $('#quickSync').disabled = true; $('#quickSync svg').style.animation = 'spin 1s linear infinite';
  setLoading(true, full ? 'Rebuilding graph…' : 'Synchronizing…');
  try {
    const result = await window.graf.project.sync({ full });
    graphCache = null; applyStatus(result.status || await window.graf.project.status());
    await updatePending();
    toast(full ? 'Graph rebuilt from source.' : 'Project synchronized.');
    if (['overview', 'tree', 'usage', 'graph'].includes(activePage)) await navigate(activePage);
  } catch (error) { toast(error.message, 'error'); }
  finally { syncInProgress = false; setLoading(false); $('#quickSync').disabled = !activeProject; const svg = $('#quickSync svg'); if (svg) svg.style.animation = ''; }
}
async function navigate(page) {
  if (!PAGES[page]) page = 'overview';
  const seq = ++navSeq;
  activePage = page;
  updateNav(); closeProjectPopover(); setLoading(true);
  try {
    if (PAGES[page].soon) showPageContent(`${pageHead(PAGES[page].title, '')}${emptyState('sparkles', 'Coming soon', PAGES[page].blurb || 'This part of Graf is not ready yet.')}`, seq);
    else if (page === 'projects') await renderProjects();
    else if (page === 'settings') await renderSettings();
    else if (page === 'integrations') await renderIntegrations();
    else if (!activeProject) await showWelcome();
    else {
      switch (page) {
        case 'overview': await renderOverview(); break;
        case 'tree': await renderTree(); break;
        case 'usage': await renderUsage(); break;
        case 'graph': await renderGraph(); break;
        case 'explorer': await renderExplorer(); break;
        case 'search': await renderSearch(); break;
        case 'impact': await renderImpact(); break;
        case 'context': await renderContext(); break;
        case 'memory': await renderMemory(); break;
        case 'history': await renderHistory(); break;
        case 'proposals': await renderProposals(); break;
        case 'diagnostics': await renderDiagnostics(); break;
      }
    }
  } catch (error) {
    if (seq === navSeq) {
      showPageContent(`${pageHead(PAGES[page].title, '')}${emptyState('warn', 'This page could not be loaded', error.message, btn('Try again', 'retry-page', { v: 'primary', i: 'sync' }))}`, seq);
      toast(error.message, 'error');
    }
  } finally { if (seq === navSeq) setLoading(false); }
}

/* ==========================================================================
   Overview
   ========================================================================== */
const ACTIVITY_ICON = { index: 'code', snapshot: 'camera', pin: 'pin', 'human-edge': 'link', 'human-edge-delete': 'link', memory: 'memory', proposal: 'proposals' };
function kindCounts(graph) {
  const counts = {};
  for (const n of graph.nodes) counts[n.kind] = (counts[n.kind] || 0) + 1;
  return counts;
}
function cyStyle({ mini = false } = {}) {
  const shapes = { file: 'round-rectangle', class: 'hexagon', route: 'diamond', config: 'round-tag', module: 'barrel', note: 'round-pentagon' };
  const style = [
    { selector: 'node', style: { label: mini ? '' : 'data(label)', 'font-family': 'Geist, system-ui, sans-serif', 'font-size': 10, 'font-weight': 500, color: '#d8dae0', 'text-valign': 'bottom', 'text-margin-y': 5, 'text-wrap': 'ellipsis', 'text-max-width': 110, 'text-outline-width': 3, 'text-outline-color': '#08080a', 'min-zoomed-font-size': 9, 'background-color': '#aeb2bb', width: 'data(size)', height: 'data(size)', 'border-width': 1.5, 'border-color': 'rgba(255,255,255,.28)', shape: 'ellipse' } },
    { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#ffffff', 'z-index': 999, 'overlay-color': '#ffffff', 'overlay-opacity': .08, 'overlay-padding': 6 } },
    { selector: 'node[provenance = "manual"]', style: { 'border-style': 'dashed', 'border-color': '#ffe08a', 'border-width': 2 } },
    { selector: 'edge', style: { width: 1, 'line-color': 'rgba(150,156,170,.38)', 'target-arrow-color': 'rgba(150,156,170,.55)', 'target-arrow-shape': mini ? 'none' : 'triangle', 'arrow-scale': .7, 'curve-style': mini ? 'haystack' : 'bezier', opacity: .9 } },
    { selector: 'edge[provenance = "inferred"]', style: { 'line-style': 'dotted', 'line-color': 'rgba(150,156,170,.3)' } },
    { selector: 'edge[provenance = "manual"]', style: { 'line-style': 'dashed', width: 1.8, 'line-color': '#ffe08a', 'target-arrow-color': '#ffe08a', opacity: 1 } },
    { selector: '.dim', style: { opacity: .1 } },
    { selector: 'edge.hl', style: { width: 2, 'line-color': '#f2f3f5', 'target-arrow-color': '#f2f3f5', opacity: 1, 'z-index': 998 } },
    { selector: '.faded', style: { opacity: .06 } }
  ];
  for (const [kind, info] of Object.entries(KIND)) style.push({ selector: `node[kind = "${kind}"]`, style: { 'background-color': info.color, shape: shapes[kind] || 'ellipse' } });
  return style;
}
function graphElements(data) {
  const degree = new Map();
  for (const e of data.edges) { degree.set(e.src, (degree.get(e.src) || 0) + 1); degree.set(e.dst, (degree.get(e.dst) || 0) + 1); }
  const ids = new Set(data.nodes.map(n => n.id));
  return [
    ...data.nodes.map(n => ({ data: { id: n.id, label: n.name || n.id, kind: n.kind, path: n.path, provenance: n.provenance, size: (n.kind === 'file' ? 20 : 12) + Math.min(18, Math.sqrt(degree.get(n.id) || 0) * 4.2) } })),
    ...data.edges.filter(e => ids.has(e.src) && ids.has(e.dst)).map(e => ({ data: { id: e.id, source: e.src, target: e.dst, type: e.type, provenance: e.provenance } }))
  ];
}
const COSE = { name: 'cose', animate: false, randomize: true, fit: true, padding: 30, nodeRepulsion: () => 11000, idealEdgeLength: () => 70, edgeElasticity: () => 90, gravity: .35, componentSpacing: 50, nodeOverlap: 14, numIter: 350 };
function legendHtml(counts) {
  return Object.keys(KIND).filter(k => counts?.[k]).map(k => `<span class="legend-item">${kindDot(k)}${KIND[k].label}${counts ? ` <span class="mono" style="color:var(--dim)">${number(counts[k])}</span>` : ''}</span>`).join('');
}
async function renderOverview() {
  const seq = navSeq;
  const [overview, status, changes, usage, graph, savedLayout] = await Promise.all([
    window.graf.project.overview(1), window.graf.project.status(), window.graf.changes.list().catch(() => []),
    window.graf.usage.summary({ days: 14 }), getGraph(), window.graf.graph.layout.get().catch(() => ({}))
  ]);
  const counts = kindCounts(graph);
  const symbols = (counts.function || 0) + (counts.class || 0) + (counts.route || 0);
  const pendingReview = PENDING.memories + PENDING.proposals;
  const capped = graph.truncated;
  const stats = [
    ['Files', status.files, 'file', 'Indexed source files'],
    ['Symbols', symbols, 'func', `${number(counts.function || 0)} functions · ${number(counts.class || 0)} classes`],
    ['Nodes', status.nodes, 'graph', 'Active graph nodes'],
    ['Relationships', status.edges, 'link', 'Graph edges'],
    ['Agent calls', usage.totals.calls, 'zap', usage.totals.calls ? `${fmtTokens(usage.totals.responseTokens)} tokens served` : 'No agent has used Graf yet'],
    ['Est. tokens saved', fmtTokens(usage.totals.savedTokens), 'chart', usage.totals.baselineTokens ? `${usage.totals.savedPct}% less than reading files` : 'Appears after agent calls']
  ];
  const stale = status.staleFiles || 0;
  const recent = [...changes].reverse().slice(0, 6);
  const maxKind = Math.max(1, ...Object.values(counts));
  const html = `${pageHead(escapeHtml(overview.project || activeProject.name), `<span class="mono" style="font-size:12.5px">${escapeHtml(formatDisplayPath(overview.root || activeProject.path))}</span>`,
    `${btn('Sync now', 'sync', { i: 'sync' })}${btn('Open project tree', 'nav-graph', { v: 'primary', i: 'tree' })}`,
    `${(overview.stack || []).map(s => `<span class="tag"><i class="lang-dot" style="background:${langColor(s)}"></i>${escapeHtml(s)}</span>`).join('')}${status.branch ? `<span class="tag mono">${icon('branch', 12)}${escapeHtml(status.branch)}</span>` : ''}<span class="tag ${stale ? 'warning' : 'success'}">${stale ? `${number(stale)} stale` : 'Up to date'}</span>`)}
    <div class="stat-grid">${stats.map(([label, value, ic, meta]) => `<div class="stat-card"><div class="stat-label">${icon(ic, 14)}${label}</div><div class="stat-value">${number(value)}</div><div class="stat-meta">${escapeHtml(meta)}</div></div>`).join('')}</div>
    <div class="dashboard-grid">
      <div class="stack">
        <div class="panel"><div class="panel-head"><div><div class="panel-title">Project graph</div><div class="panel-sub">A live structural map of your codebase${capped ? ` · showing ${number(graph.nodes.length)} of ${number(graph.totalNodes)} nodes` : ''}</div></div><button type="button" class="text-link" data-action="nav-graph">Open graph ${icon('external', 13)}</button></div><div class="graph-preview" id="miniGraph"></div><div class="legend" style="margin-top:12px">${legendHtml(counts)}</div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Recent activity</div></div>${recent.map(c => `<div class="activity-row"><div class="activity-symbol">${icon(ACTIVITY_ICON[c.cause] || 'diff', 15)}</div><div class="activity-copy"><strong>${escapeHtml(cap(c.cause))} · ${escapeHtml(c.entity)}</strong><small>${escapeHtml(c.entityId)}</small></div><div class="activity-time">${escapeHtml(timeAgo(c.ts))}</div></div>`).join('') || '<div class="small-muted">No activity recorded yet.</div>'}</div>
      </div>
      <div class="stack">
        <div class="panel"><div class="panel-head"><div class="panel-title">Graph health</div><span class="tag ${stale ? 'warning' : 'success'}">${stale ? 'Needs sync' : 'Healthy'}</span></div>
          <div class="kv"><span>Database</span><span class="mono">${escapeHtml(status.backend || '—')}</span></div>
          <div class="kv"><span>Branch</span><span class="mono">${escapeHtml(status.branch || '—')}</span></div>
          <div class="kv"><span>Commit</span><span class="mono">${escapeHtml((status.commit || '—').slice(0, 10))}</span></div>
          <div class="kv"><span>Stale files</span><span>${number(stale)}</span></div>
          <div class="kv"><span>Last indexed</span><span title="${escapeHtml(fmtDate(status.updatedAt))}">${escapeHtml(timeAgo(status.updatedAt))}</span></div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Node types</div></div>${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="bar-row"><span class="bar-label">${kindDot(k)}${escapeHtml(kindInfo(k).label)}</span><span class="bar"><i style="width:${Math.max(3, n / maxKind * 100)}%;background:${kindInfo(k).color}"></i></span><span class="bar-num">${number(n)}</span></div>`).join('')}</div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Quick actions</div></div><div class="quick-grid">
          <button type="button" class="quick-action" data-action="nav-graph">${icon('tree', 16)}Project tree</button>
          <button type="button" class="quick-action" data-action="nav-graph-explorer">${icon('graph', 16)}Graph explorer</button>
          <button type="button" class="quick-action" data-action="nav-integrations">${icon('integrations', 16)}Connect agent</button>
          <button type="button" class="quick-action" data-action="nav-usage">${icon('chart', 16)}Usage & savings</button>
          <button type="button" class="quick-action" data-action="sync">${icon('sync', 16)}Sync now</button>
          <button type="button" class="quick-action" data-action="rebuild-graph">${icon('restore', 16)}Full rebuild</button></div></div>
      </div>
    </div>`;
  if (!showPageContent(html, seq)) return;
  applyStatus(status);
  const box = $('#miniGraph');
  if (!graph.nodes.length) box.innerHTML = `<div class="empty-card">${emptyState('graph', 'No graph yet', 'Synchronize the project to index its files.')}</div>`;
  else if (window.cytoscape) {
    const startLayout = chooseInitialGraphLayout(graph.nodes, savedLayout);
    const usePreset = startLayout.hasCompleteLayout;
    const miniLayoutOpts = usePreset
      ? { name: 'preset', positions: n => savedLayout[n.id()] || n.position(), fit: true, padding: 20 }
      : { ...COSE, numIter: graph.nodes.length > 500 ? 100 : 200, padding: 20, animate: false };

    miniCy = window.cytoscape({
      container: box,
      elements: graphElements(graph),
      style: cyStyle({ mini: true }),
      layout: miniLayoutOpts,
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      autoungrabify: true,
      autounselectify: true,
      selectionType: 'none',
      textureOnViewport: true,
      motionBlur: false,
      pixelRatio: 1
    });

    if (!usePreset) {
      miniCy.one('layoutstop', () => {
        if (!miniCy) return;
        const layout = {};
        let hasSpread = false;
        miniCy.nodes().forEach(n => {
          const p = n.position();
          if (p && (p.x !== 0 || p.y !== 0)) hasSpread = true;
          layout[n.id()] = p;
        });
        if (hasSpread) window.graf.graph.layout.save(layout).catch(() => {});
      });
    }

    miniCy.on('tap', () => navigate('tree'));
    box.onclick = () => navigate('tree');
    box.style.cursor = 'pointer';
  } else box.innerHTML = `<div class="empty-card"><span>Graph library failed to load.</span></div>`;
}

/* ==========================================================================
   Projects
   ========================================================================== */
async function renderProjects() {
  const seq = navSeq;
  const projects = await window.graf.projects.list();
  const usageRows = (await window.graf.usage.all().catch(() => ({ projects: [] }))).projects;
  const statLine = p => { const r = usageRows.find(x => x.path === p.path); return r && r.exists && r.nodes ? `<span class="proj-stats">${number(r.files)} files · ${number(r.nodes)} nodes${r.totals?.calls ? ` · ${number(r.totals.calls)} agent calls · ~${fmtTokens(r.totals.savedTokens)} tokens saved` : ''}</span>` : ''; };
  const sorted = [...projects].sort((a, b) => String(b.lastOpenedAt || '').localeCompare(String(a.lastOpenedAt || '')));
  const html = `${pageHead('Projects', 'Local workspaces registered with Graf. Removing a project never deletes your files.', `${btn('Add project', 'add-project', { v: 'primary', i: 'plus' })}`)}
    <div class="panel">${sorted.map(p => {
      const isActive = activeProject?.path === p.path;
      return `<div class="project-row"><span class="project-avatar">${escapeHtml((p.name || '?')[0])}</span><div class="pr-copy"><strong>${escapeHtml(p.name)}${isActive ? '<span class="tag success">Active</span>' : ''}${p.exists === false ? '<span class="tag danger">Folder missing</span>' : ''}</strong><small title="${escapeHtml(p.path)}">${escapeHtml(formatDisplayPath(p.path))}</small>${statLine(p)}<em>${p.lastOpenedAt ? `Opened ${escapeHtml(timeAgo(p.lastOpenedAt))}` : 'Never opened'}</em></div><div class="row-actions">${p.exists === false ? btn('Locate folder', 'repair-project', { s: true, i: 'folderOpen', a: `data-path="${escapeHtml(p.path)}"` }) : btn(isActive ? 'Open' : 'Open', 'open-project', { v: isActive ? 'secondary' : 'primary', s: true, a: `data-path="${escapeHtml(p.path)}"` })}${p.exists !== false ? btn('Re-index', 'reindex-project', { s: true, i: 'sync', a: `data-path="${escapeHtml(p.path)}"`, t: 'Full rebuild of this project’s graph' }) : ''}${iconBtn('edit', 'rename-project', 'Rename project', `data-path="${escapeHtml(p.path)}" data-name="${escapeHtml(p.name)}"`)}${iconBtn('trash', 'remove-project', 'Remove from Graf', `data-path="${escapeHtml(p.path)}" data-name="${escapeHtml(p.name)}"`)}</div></div>`;
    }).join('') || emptyState('projects', 'No projects yet', 'Add a local repository to build its knowledge graph.', btn('Add project', 'add-project', { v: 'primary', i: 'plus' }))}</div>`;
  showPageContent(html, seq);
}

/* ==========================================================================
   Graph explorer
   ========================================================================== */
async function renderGraph() {
  const seq = navSeq;
  const [data, layout] = await Promise.all([getGraph(true), window.graf.graph.layout.get().catch(() => ({}))]);
  const counts = kindCounts(data);
  const startLayout = chooseInitialGraphLayout(data.nodes, layout);
  graphHasCompleteLayout = startLayout.hasCompleteLayout;
  const kinds = Object.keys(counts).sort();
  const types = [...new Set(data.edges.map(e => e.type))].sort();
  const provs = [...new Set(data.edges.map(e => e.provenance).filter(Boolean))].sort();
  const html = `<div class="fill-head">${pageHead('Graph Explorer', 'Structure and relationships inside this project. Source-derived edges are read-only.', `${btn('Note node', 'add-node', { i: 'plus', s: true })}${btn('Relationship', 'add-edge', { i: 'link', s: true })}${btn('Refresh', 'refresh-graph', { i: 'sync', s: true })}`)}</div>
    <div class="toolbar"><div class="input-icon">${icon('search', 14)}<input id="graphFilter" class="input-sm" placeholder="Filter visible nodes…" aria-label="Filter nodes"></div>
      <select id="graphKind" class="input-sm" aria-label="Node type"><option value="">All node types</option>${kinds.map(k => `<option value="${k}">${escapeHtml(kindInfo(k).label)} (${counts[k]})</option>`).join('')}</select>
      <select id="graphEdgeType" class="input-sm" aria-label="Relationship type"><option value="">All relationships</option>${types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</select>
      <select id="graphProv" class="input-sm" aria-label="Provenance"><option value="">All provenance</option>${provs.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(cap(p))}</option>`).join('')}</select>
      <select id="graphLayout" class="input-sm" aria-label="Layout">${graphHasCompleteLayout ? '<option value="preset">Saved positions</option>' : ''}<option value="cose">Force directed</option><option value="concentric">Radial</option><option value="breadthfirst">Hierarchy</option><option value="circle">Circle</option><option value="grid">Grid</option></select>
      <label class="toggle"><span class="switch"><input type="checkbox" id="graphLabels" checked><i></i></span>Labels</label>
      <span class="toolbar-note" id="graphCount"></span></div>
    <div class="graph-layout"><div class="graph-stage" id="graphStage">${data.nodes.length ? '<div id="cy"></div>' : `<div style="position:absolute;inset:0;display:grid;place-items:center;padding:30px">${emptyState('graph', 'The graph is empty', 'Synchronize the project to index files, symbols and relationships.', btn('Sync now', 'sync', { v: 'primary', i: 'sync' }))}</div>`}
      ${data.nodes.length ? `<div class="graph-overlay graph-controls">${iconBtn('plus', 'graph-zoom-in', 'Zoom in')}${iconBtn('minus', 'graph-zoom-out', 'Zoom out')}${iconBtn('fit', 'fit-graph', 'Fit graph to view')}</div><div class="graph-overlay graph-legend-box legend">${legendHtml(counts)}<span class="legend-item"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#f0908f00"/><line x1="0" y1="3" x2="22" y2="3" stroke="#ffe08a" stroke-width="1.8" stroke-dasharray="4 3"/></svg>Manual</span></div><div class="graph-overlay graph-hint">Drag to pan · scroll to zoom · click a node to inspect</div>` : ''}</div>
      <aside class="panel flush inspector" id="inspector" aria-live="polite"><div class="inspector-empty"><div class="es-icon">${icon('graph', 20)}</div><strong style="color:var(--text)">Node inspector</strong><span>Select a node to see its source, provenance, relationships and impact. ${data.truncated ? `<br><br>Showing ${number(data.nodes.length)} of ${number(data.totalNodes)} nodes.` : ''}</span></div></aside></div>`;
  if (!showPageContent(html, seq)) return;
  if (!data.nodes.length) return;
  if (!window.cytoscape) { $('#graphStage').innerHTML = emptyState('warn', 'Graph library failed to load', 'Reinstall Graf or run the vendor copy step.'); return; }
  cy = window.cytoscape({ container: $('#cy'), elements: graphElements(data), style: cyStyle(), wheelSensitivity: .25, minZoom: .05, maxZoom: 4, boxSelectionEnabled: false, textureOnViewport: data.nodes.length > 400, hideEdgesOnViewport: data.edges.length > 1500 });
  const positions = startLayout.name === 'preset' ? layout : null;
  const runLayout = (name, animate = true) => {
    const opts = name === 'cose' ? { ...COSE, animate: false } : name === 'preset' ? { name: 'preset', positions: n => positions?.[n.id()] || n.position(), fit: true, padding: 40 } : { name, fit: true, padding: 40, animate, animationDuration: 350, spacingFactor: name === 'breadthfirst' ? 1.1 : 1 };
    const l = cy.layout(opts);
    l.one('layoutstop', saveGraphLayout);
    l.run();
  };
  runLayout(startLayout.name, false);
  $('#graphLayout').value = startLayout.name === 'preset' ? 'preset' : 'cose';
  const tip = document.createElement('div'); tip.className = 'graph-tip hidden'; $('#graphStage').append(tip);
  cy.one('tap pan zoom', () => $('.graph-hint')?.remove());
  const highlight = node => {
    cy.elements().removeClass('dim hl');
    if (!node) return;
    const hood = node.closedNeighborhood();
    cy.elements().not(hood).addClass('dim');
    node.connectedEdges().addClass('hl');
  };
  cy.on('tap', 'node', event => { selectedNode = event.target.id(); highlight(event.target); showNodeInspector(selectedNode).catch(e => toast(e.message, 'error')); });
  cy.on('dbltap', 'node', async event => { selectedNode = event.target.id(); await actions['show-in-tree'](); });
  cy.on('tap', event => { if (event.target === cy) { selectedNode = null; highlight(null); renderInspectorEmpty(); } });
  cy.on('mouseover', 'node', event => {
    const n = event.target; const p = n.renderedPosition();
    tip.innerHTML = `<b>${escapeHtml(n.data('label'))}</b><span>${escapeHtml(kindInfo(n.data('kind')).label)}${n.data('path') ? ' · ' + escapeHtml(n.data('path')) : ''}</span>`;
    tip.classList.remove('hidden'); tip.style.left = `${Math.min(p.x + 14, $('#graphStage').clientWidth - 330)}px`; tip.style.top = `${Math.max(8, p.y - 12)}px`;
    $('#cy').style.cursor = 'pointer';
  });
  cy.on('mouseout', 'node', () => { tip.classList.add('hidden'); $('#cy').style.cursor = ''; });
  cy.on('pan zoom dragpan', () => tip.classList.add('hidden'));
  cy.on('dragfree', 'node', () => { saveGraphLayout(); });
  const apply = () => {
    const text = $('#graphFilter').value.trim().toLowerCase(); const kind = $('#graphKind').value; const type = $('#graphEdgeType').value; const prov = $('#graphProv').value;
    let visible = 0;
    cy.batch(() => {
      cy.nodes().forEach(n => { const match = (!kind || n.data('kind') === kind) && (!text || `${n.data('label')} ${n.data('path') || ''}`.toLowerCase().includes(text)); n.toggleClass('faded', !match); if (match) visible++; });
      cy.edges().forEach(e => { const match = (!type || e.data('type') === type) && (!prov || e.data('provenance') === prov) && !e.source().hasClass('faded') && !e.target().hasClass('faded'); e.toggleClass('faded', !match); });
    });
    $('#graphCount').textContent = `${number(visible)} of ${number(cy.nodes().length)} nodes · ${number(cy.edges().not('.faded').length)} edges`;
  };
  for (const id of ['graphKind', 'graphEdgeType', 'graphProv']) $('#' + id).addEventListener('change', apply);
  $('#graphFilter').addEventListener('input', apply);
  $('#graphLayout').addEventListener('change', event => runLayout(event.target.value));
  $('#graphLabels').addEventListener('change', event => cy.style().selector('node').style('text-opacity', event.target.checked ? 1 : 0).update());
  apply();
  if (selectedNode && cy.getElementById(selectedNode).nonempty()) { const n = cy.getElementById(selectedNode); n.select(); highlight(n); cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1.1) }, { duration: 300 }); showNodeInspector(selectedNode).catch(() => {}); }
}
let layoutSaveTimer = null;
function saveGraphLayout() {
  if (!cy) return;
  clearTimeout(layoutSaveTimer);
  layoutSaveTimer = setTimeout(() => {
    if (!cy) return;
    const layout = {}; cy.nodes().forEach(n => { layout[n.id()] = n.position(); });
    window.graf.graph.layout.save(layout).catch(() => {});
  }, 400);
}
window.addEventListener('beforeunload', () => { if (cy) { const layout = {}; cy.nodes().forEach(n => { layout[n.id()] = n.position(); }); window.graf.graph.layout.save(layout).catch(() => {}); } });
function renderInspectorEmpty() {
  const el = $('#inspector'); if (!el) return;
  el.innerHTML = `<div class="inspector-empty"><div class="es-icon">${icon('graph', 20)}</div><strong style="color:var(--text)">Node inspector</strong><span>Select a node to see its source, provenance, relationships and impact.</span></div>`;
}
async function showNodeInspector(nodeId) {
  const inspector = $('#inspector'); if (!inspector) return;
  const [node, notes, graph] = await Promise.all([window.graf.graph.node(nodeId), window.graf.notes.forNode(nodeId).catch(() => []), getGraph()]);
  if (selectedNode !== nodeId || !$('#inspector')) return;
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const edges = node.edges || [];
  const rel = edges.slice(0, 14).map(edge => {
    const outgoing = edge.src === nodeId; const other = outgoing ? edge.dst : edge.src; const o = byId.get(other);
    return `<div class="rel-row"><span class="rel-type">${icon(outgoing ? 'right' : 'left', 12)}${escapeHtml(edge.type)}</span><span class="rel-end">${o ? kindDot(o.kind) : ''}<button type="button" class="text-link" data-action="inspect-node" data-id="${escapeHtml(other)}" title="${escapeHtml(other)}">${escapeHtml(o?.name || shortId(other, 28))}</button>${edge.provenance === 'manual' ? `<button type="button" class="icon-button" style="width:22px;height:22px" data-action="remove-edge" data-edge="${escapeHtml(edge.id)}" title="Remove manual relationship" aria-label="Remove manual relationship">${icon('x', 12)}</button>` : ''}</span></div>`;
  }).join('');
  inspector.innerHTML = `<div class="inspector-head"><div class="inspector-kindline">${kindIcon(node.kind, 15)}<span>${escapeHtml(kindInfo(node.kind).label)}</span><span class="tag ${node.provenance === 'manual' ? 'warning' : node.provenance === 'verified' ? 'success' : ''}">${escapeHtml(node.provenance || 'unknown')}</span>${node.stale ? '<span class="tag warning">stale</span>' : ''}${node.pinned ? `<span class="tag info">${icon('pin', 11)}pinned</span>` : ''}</div><div class="inspector-name">${escapeHtml(node.name || node.id)}</div>${node.path ? `<div class="inspector-path">${escapeHtml(node.path)}${node.lineStart ? `:${node.lineStart}${node.lineEnd && node.lineEnd !== node.lineStart ? '–' + node.lineEnd : ''}` : ''}</div>` : ''}</div>
    ${node.signature ? `<div class="inspector-section"><div class="inspector-section-title">Signature</div><div class="code-inline" style="display:block">${escapeHtml(node.signature)}</div></div>` : ''}
    <div class="inspector-section"><div class="inspector-section-title">Summary</div><div class="inspector-summary">${escapeHtml(node.summary || 'No summary yet.')}</div></div>
    <div class="inspector-section"><div class="inspector-section-title"><span>Relationships</span><span>${edges.length}</span></div>${rel || '<div class="small-muted">No relationships.</div>'}${edges.length > 14 ? `<div class="small-muted" style="margin-top:6px">Showing 14 of ${edges.length}.</div>` : ''}</div>
    ${notes.length ? `<div class="inspector-section"><div class="inspector-section-title"><span>Human notes</span><span>${notes.length}</span></div>${notes.slice(0, 4).map(n => `<div class="inspector-note">${escapeHtml(n.text || n.content || '')}<small>${escapeHtml(fmtDate(n.createdAt))}</small></div>`).join('')}</div>` : ''}
    <div class="inspector-section"><div class="inspector-section-title">Identifier</div><div class="inspector-path" style="margin:0">${escapeHtml(node.id)}</div></div>
    <div class="inspector-actions">${btn('Show in tree', 'show-in-tree', { i: 'tree', s: true, v: 'primary' })}${node.path ? btn('Reveal file', 'tree-reveal', { i: 'external', s: true, a: `data-path="${escapeHtml(node.path)}"` }) : ''}${btn('Note', 'add-node-note', { i: 'note', s: true })}${btn('Summary', 'edit-node-summary', { i: 'edit', s: true })}${btn(node.pinned ? 'Unpin' : 'Pin', 'toggle-node-pin', { i: 'pin', s: true, a: `data-pinned="${node.pinned ? 'true' : 'false'}"` })}${btn('Hide', 'toggle-node-hidden', { i: 'eyeOff', s: true, a: 'data-hidden="false"' })}${iconBtn('copy', 'copy-text', 'Copy node ID', `data-text="${escapeHtml(node.id)}"`)}</div>`;
}

/* ==========================================================================
   Project Tree
   ========================================================================== */
let treeState = { project: null, mode: 'structure', focusId: null, data: null, expanded: new Set(), query: '' };
const TREE_MODES = { structure: 'Project structure', imports: 'Import trees (entry files)' };
function treeApiOptions() {
  if (treeState.mode === 'uses') return { mode: 'dependencies', id: treeState.focusId, depth: 4 };
  if (treeState.mode === 'dependents') return { mode: 'dependents', id: treeState.focusId, depth: 4 };
  return { mode: treeState.mode === 'imports' ? 'dependencies' : 'structure' };
}
function findTreeNode(roots, id) {
  for (const root of roots) { if (root.id === id) return root; const hit = findTreeNode(root.children || [], id); if (hit) return hit; }
  return null;
}
function treeNodeHtml(node, expanded) {
  const k = kindInfo(node.kind); const kids = node.children || []; const open = kids.length > 0 && expanded.has(node.id);
  const facts = cardFacts(node).filter(Boolean).join(' · ');
  const card = `<div class="tcard${selectedNode === node.id ? ' selected' : ''}${node.ref ? ' is-ref' : ''}" data-action="tree-select" data-id="${escapeHtml(node.id)}" title="${escapeHtml(node.summary || node.path || node.name)}" style="--kc:${k.color}">${kids.length ? `<button type="button" class="tcaret" data-action="tree-toggle" data-id="${escapeHtml(node.id)}" aria-label="${open ? 'Collapse' : 'Expand'} ${escapeHtml(node.name)}" aria-expanded="${open}">${icon(open ? 'down' : 'right', 12)}</button>` : '<span class="tcaret-gap"></span>'}<span class="tico">${icon(k.icon, 14)}</span><span class="tbody"><span class="tname">${escapeHtml(node.name)}</span>${facts ? `<span class="tfacts">${escapeHtml(facts)}</span>` : ''}</span>${node.via ? `<span class="tvia">${escapeHtml(node.via)}</span>` : ''}${kids.length ? `<span class="tcount">${number(node.count ?? kids.length)}</span>` : ''}${node.truncated ? '<span class="tvia" title="Output limited">more…</span>' : ''}</div>`;
  if (!open) return `<div class="tnode">${card}</div>`;
  return `<div class="tnode">${card}<div class="tkids">${kids.map(c => `<div class="tkid">${treeNodeHtml(c, expanded)}</div>`).join('')}</div></div>`;
}
function paintTree() {
  const stage = $('#treeStage'); if (!stage || !treeState.data) return;
  if (!treeState.query && treeState.mode === 'structure' && treeState.data.total <= 1) {
    stage.innerHTML = `<div class="empty-card">${emptyState('folder', 'No files indexed in this project', 'Graf found no supported source files here. Check that the folder has code, and that .grafignore is not excluding everything, then sync.', btn('Sync now', 'sync', { v: 'primary', i: 'sync' }))}</div>`;
    $('#treeCount').textContent = '0 nodes';
    return;
  }
  const { roots, matches } = filterTree(treeState.data.roots, treeState.query);
  const expanded = treeState.query ? expandAll(roots) : treeState.expanded;
  stage.innerHTML = roots.length ? roots.map(r => `<div class="tree-block">${treeNodeHtml(r, expanded)}</div>`).join('') : `<div class="empty-card">${emptyState('search', treeState.query ? 'No matches' : 'Nothing to show', treeState.query ? 'Try a different filter.' : 'Synchronize the project to index its files.')}</div>`;
  const total = treeState.data.total;
  $('#treeCount').textContent = treeState.query ? `${number(matches)} match${matches === 1 ? '' : 'es'} · ${number(total)} nodes` : `${number(total)} nodes · ${number(treeState.data.roots.length)} tree${treeState.data.roots.length === 1 ? '' : 's'}`;
}
function centerTreeOnRoot() {
  const stage = $('#treeStage'); const card = stage?.querySelector('.tree-block .tcard'); if (!card) return;
  const a = card.getBoundingClientRect(), b = stage.getBoundingClientRect();
  stage.scrollTop += a.top - b.top - (stage.clientHeight / 2 - a.height / 2);
  stage.scrollLeft = 0;
}
async function renderTree() {
  const seq = navSeq;
  if (treeState.project !== activeProject.path) treeState = { project: activeProject.path, mode: 'structure', focusId: null, data: null, expanded: new Set(), query: '' };
  const data = await window.graf.tree.get(treeApiOptions());
  treeState.data = data;
  treeState.expanded = expandedToDepth(data.roots, 2);
  const focus = treeState.focusId ? findTreeNode(data.roots, treeState.focusId) : null;
  const modeSelect = `<select id="treeMode" class="input-sm" aria-label="Tree type">${Object.entries(TREE_MODES).map(([k, v]) => `<option value="${k}" ${treeState.mode === k ? 'selected' : ''}>${v}</option>`).join('')}${focus ? `<option value="${treeState.mode}" selected>${treeState.mode === 'uses' ? 'What it uses' : 'What depends on it'}</option>` : ''}</select>`;
  const html = `<div class="fill-head">${pageHead('Project Tree', 'Your project as a tree: folders, files, classes and functions. Click a card to inspect it, use the arrow to open or close its branch.', `${btn('Sync', 'sync', { i: 'sync', s: true })}`)}
    <div class="toolbar">${modeSelect}<div class="input-icon">${icon('search', 14)}<input id="treeFilter" class="input-sm" placeholder="Filter the tree…" aria-label="Filter tree" value="${escapeHtml(treeState.query)}"></div>${btn('Expand all', 'tree-expand', { s: true })}${btn('Collapse', 'tree-collapse', { s: true })}${focus ? `<span class="tag focus-chip">${icon('link', 12)}Focus: ${escapeHtml(focus.name)}<button type="button" class="chip-x" data-action="tree-unfocus" aria-label="Clear focus">${icon('x', 11)}</button></span>` : ''}<span class="toolbar-note" id="treeCount"></span></div></div>
    <div class="tree-layout"><div class="tree-stage" id="treeStage" tabindex="0" aria-label="Project tree"></div><aside class="panel flush inspector" id="treeInspector" aria-live="polite"></aside></div>`;
  if (!showPageContent(html, seq)) return;
  paintTree(); centerTreeOnRoot();
  $('#treeMode').addEventListener('change', async event => { treeState.mode = event.target.value; treeState.focusId = null; await renderTree(); });
  $('#treeFilter').addEventListener('input', event => { treeState.query = event.target.value; paintTree(); });
  if (selectedNode && findTreeNode(data.roots, selectedNode)) showTreeInspector(selectedNode).catch(() => {}); else renderTreeInspectorEmpty();
}
function renderTreeInspectorEmpty() {
  const el = $('#treeInspector'); if (!el) return;
  el.innerHTML = `<div class="inspector-empty"><div class="es-icon">${icon('tree', 20)}</div><strong style="color:var(--text)">Node details</strong><span>Select a card to see what it is, where it lives and what it connects to.</span></div>`;
}
const shortName = id => { const after = String(id).includes('#') ? String(id).split('#').pop() : String(id).replace(/^[a-z]+:/, ''); return after; };
async function showTreeInspector(id) {
  const box = $('#treeInspector'); if (!box || !treeState.data) return;
  const tn = findTreeNode(treeState.data.roots, id);
  if (!tn) return renderTreeInspectorEmpty();
  if (!isRealNode(id)) {
    box.innerHTML = `<div class="inspector-head"><div class="inspector-kindline">${kindIcon(tn.kind, 15)}<span>${escapeHtml(kindInfo(tn.kind).label)}</span></div><div class="inspector-name">${escapeHtml(tn.name)}</div>${tn.path ? `<div class="inspector-path">${escapeHtml(tn.path)}</div>` : ''}</div><div class="inspector-section"><div class="inspector-summary">${escapeHtml(tn.summary || '')}</div></div>`;
    return;
  }
  const node = await window.graf.graph.node(id);
  if (selectedNode !== id || !$('#treeInspector')) return;
  const edges = node.edges || [];
  const rel = edges.slice(0, 12).map(e => { const out = e.src === id; const other = out ? e.dst : e.src; return `<div class="rel-row"><span class="rel-type">${icon(out ? 'right' : 'left', 12)}${escapeHtml(e.type)}</span><span class="rel-end"><button type="button" class="link-button" data-action="tree-goto" data-id="${escapeHtml(other)}" title="${escapeHtml(other)}">${escapeHtml(shortName(other))}</button></span></div>`; }).join('');
  box.innerHTML = `<div class="inspector-head"><div class="inspector-kindline">${kindIcon(node.kind, 15)}<span>${escapeHtml(kindInfo(node.kind).label)}</span><span class="tag ${node.provenance === 'verified' ? 'success' : ''}">${escapeHtml(cap(node.provenance || 'verified'))}</span></div><div class="inspector-name">${escapeHtml(node.name)}</div>${node.path ? `<div class="inspector-path">${escapeHtml(node.path)}${node.lineStart ? `:${node.lineStart}${node.lineEnd && node.lineEnd !== node.lineStart ? '–' + node.lineEnd : ''}` : ''}</div>` : ''}</div>
    ${node.signature ? `<div class="inspector-section"><div class="inspector-section-title">Signature</div><div class="code-inline" style="display:block">${escapeHtml(node.signature)}</div></div>` : ''}
    <div class="inspector-section"><div class="inspector-section-title">Summary</div><div class="inspector-summary">${escapeHtml(node.summary || 'No summary yet.')}</div></div>
    <div class="inspector-section"><div class="inspector-section-title"><span>Connections</span><span>${edges.length}</span></div>${rel || '<div class="small-muted">No connections.</div>'}${edges.length > 12 ? `<div class="small-muted">+ ${edges.length - 12} more</div>` : ''}</div>
    <div class="inspector-actions">${btn('What it uses', 'tree-trace-uses', { i: 'right', s: true, v: 'primary' })}${btn('What depends on it', 'tree-trace-dependents', { i: 'left', s: true })}${node.path ? btn('Reveal file', 'tree-reveal', { i: 'external', s: true, a: `data-path="${escapeHtml(node.path)}"` }) : ''}${btn('Copy ID', 'tree-copy-id', { i: 'copy', s: true, a: `data-id="${escapeHtml(node.id)}"` })}</div>`;
}
function treeSelect(id) {
  selectedNode = id;
  $$('#treeStage .tcard.selected').forEach(el => el.classList.remove('selected'));
  const el = $$('#treeStage .tcard').find(c => c.dataset.id === id);
  if (el) { el.classList.add('selected'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  return showTreeInspector(id);
}
async function treeTrace(mode) {
  if (!selectedNode || !isRealNode(selectedNode)) throw new Error('Select a file, class or function first.');
  treeState.mode = mode; treeState.focusId = selectedNode; treeState.query = '';
  await renderTree();
}

/* ==========================================================================
   Usage & Savings
   ========================================================================== */
let usageScope = 'project';
const fmtTokens = n => { n = Number(n || 0); return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)); };
const fmtMs = ms => { ms = Number(ms || 0); if (ms < 1000) return `${Math.round(ms)} ms`; const s = ms / 1000; if (s < 90) return `${s.toFixed(1)} s`; const m = s / 60; return m < 90 ? `${m.toFixed(1)} min` : `${(m / 60).toFixed(1)} h`; };
function usageChart(days) {
  const max = Math.max(1, ...days.map(d => Math.max(d.baselineTokens, d.responseTokens)));
  return `<div class="uchart" role="img" aria-label="Tokens per day, with and without Graf">${days.map((d, i) => `<div class="ucol" title="${escapeHtml(d.day)}: ${number(d.calls)} calls · ${number(d.responseTokens)} tokens served · ~${number(d.baselineTokens)} without Graf"><div class="ubars"><i class="ubar without" style="height:${Math.max(d.baselineTokens ? 3 : 0, d.baselineTokens / max * 100)}%"></i><i class="ubar with" style="height:${Math.max(d.responseTokens ? 3 : 0, d.responseTokens / max * 100)}%"></i></div><span class="ulabel">${i % 2 === (days.length - 1) % 2 ? escapeHtml(d.day.slice(5)) : ''}</span></div>`).join('')}</div><div class="ulegend"><span><i class="ubar without"></i>Estimated without Graf</span><span><i class="ubar with"></i>With Graf (measured)</span></div>`;
}
async function renderUsage() {
  const seq = navSeq;
  const tabs = `<div class="seg" role="tablist">${[['project', 'This project'], ['all', 'All projects']].map(([id, label]) => `<button type="button" role="tab" class="seg-btn${usageScope === id ? ' active' : ''}" data-action="usage-scope" data-scope="${id}" aria-selected="${usageScope === id}">${label}</button>`).join('')}</div>`;
  if (usageScope === 'all') {
    const all = await window.graf.usage.all(); const t = all.totals;
    const html = `${pageHead('Usage & Savings', 'What Graf has served to your agents across every project. Savings are estimates; see how they are calculated below.', tabs)}
      <div class="usage-stats">${[['Agent calls', number(t.calls), 'MCP tool calls answered'], ['Tokens served', fmtTokens(t.responseTokens), 'What agents received'], ['Est. tokens saved', fmtTokens(t.savedTokens), `${t.savedPct}% less than reading files`], ['Est. time saved', fmtMs(t.savedMs), `${fmtMs(t.measuredMs)} actually spent`]].map(([l, v, m]) => `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-meta">${escapeHtml(m)}</div></div>`).join('')}</div>
      <div class="panel"><div class="panel-head"><div class="panel-title">${icon('projects', 16)}Projects</div></div><div class="utable"><div class="urow uhead"><span>Project</span><span>Files</span><span>Nodes</span><span>Calls</span><span>Tokens served</span><span>Est. saved</span><span></span></div>${all.projects.map(r => `<div class="urow"><span class="uname"><strong>${escapeHtml(r.name)}</strong>${r.active ? '<span class="tag success">Active</span>' : ''}${r.exists ? '' : '<span class="tag danger">Folder missing</span>'}<small>${escapeHtml(r.path)}</small></span><span>${number(r.files)}</span><span>${number(r.nodes)}</span><span>${number(r.totals?.calls)}</span><span>${fmtTokens(r.totals?.responseTokens)}</span><span>${fmtTokens(r.totals?.savedTokens)}</span><span>${r.exists && !r.active ? btn('Open', 'open-project-row', { s: true, a: `data-path="${escapeHtml(r.path)}"` }) : ''}</span></div>`).join('') || '<div class="small-muted" style="padding:14px">No projects yet.</div>'}</div></div>`;
    showPageContent(html, seq); return;
  }
  const u = await window.graf.usage.summary({ days: 14 }); const t = u.totals; const g = u.graphUpdates; const w = u.tasks.withGraf, wo = u.tasks.without;
  const hasTasks = w.n && wo.n;
  const cmp = (label, a, b, fmt) => { const better = b && a ? Math.round((1 - a / b) * 100) : null; return `<div class="cmp-row"><span>${label}</span><strong>${fmt(a)}</strong><em>${fmt(b)}</em><span class="${better > 0 ? 'good' : ''}">${better === null ? '—' : better > 0 ? `${better}% less` : `${-better}% more`}</span></div>`; };
  const html = `${pageHead('Usage & Savings', 'Tokens and time spent by your coding agents when they ask Graf instead of reading files. Written by the MCP server on every call.', `${tabs}${btn('Clear', 'usage-clear', { s: true, i: 'trash' })}`)}
    <div class="usage-stats">${[['Agent calls', number(t.calls), `avg ${fmtMs(t.avgMs)} per call`], ['Tokens served', fmtTokens(t.responseTokens), `avg ${number(t.avgResponseTokens)} per call`], ['Est. tokens saved', fmtTokens(t.savedTokens), t.baselineTokens ? `${t.savedPct}% less than reading files` : 'Appears after the first calls'], ['Est. time saved', fmtMs(t.savedMs), `${fmtMs(t.measuredMs)} actually spent`]].map(([l, v, m]) => `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-meta">${escapeHtml(m)}</div></div>`).join('')}</div>
    <div class="usage-grid"><div class="panel"><div class="panel-head"><div class="panel-title">${icon('chart', 16)}Last 14 days</div></div>${t.calls ? usageChart(u.byDay) : emptyState('chart', 'No agent calls yet', 'Connect an agent in Integrations and ask it to work on this project. Calls show up here instantly.', btn('Open Integrations', 'nav-integrations', { s: true }))}</div>
      <div class="panel"><div class="panel-head"><div class="panel-title">${icon('sync', 16)}Keeping the graph up to date</div></div><div class="big-zero">0<small>LLM tokens</small></div><p class="small-muted">Indexing runs locally on your computer and only re-reads files that changed. Updating the graph never costs any tokens.</p><div class="kv"><span>Automatic updates</span><strong>${number(g.syncs)}</strong><span>Files re-indexed</span><strong>${number(g.filesIndexed)}</strong><span>Time spent</span><strong>${fmtMs(g.totalMs)}</strong><span>Last update</span><strong>${g.last ? escapeHtml(timeAgo(g.last)) : '—'}</strong></div></div></div>
    <div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">${icon('clock', 16)}With Graf vs without Graf</div><span class="small-muted">reported by agents</span></div>${hasTasks ? `<div class="cmp-head"><span></span><span>With Graf (${w.n})</span><span>Without (${wo.n})</span><span>Difference</span></div>${cmp('Avg tokens per task', w.avgTokens, wo.avgTokens, fmtTokens)}${cmp('Avg time per task', w.avgMs, wo.avgMs, fmtMs)}` : `<p class="small-muted" style="margin:0">Agents can call the <span class="mono">report_usage</span> tool after a task with their real token count and time. Once there are tasks reported both with and without Graf, the comparison appears here. ${w.n ? `${w.n} task${w.n === 1 ? '' : 's'} with Graf reported so far.` : ''}</p>`}${u.tasks.recent.length ? `<div class="ulist">${u.tasks.recent.map(x => `<div class="urow-lite"><span class="tag ${x.withGraf ? 'success' : ''}">${x.withGraf ? 'With Graf' : 'Without'}</span><span class="grow">${escapeHtml(x.task)}</span><span class="mono">${fmtTokens(x.tokens)} tok</span><span class="mono">${fmtMs(x.ms)}</span></div>`).join('')}</div>` : ''}</div>
    <div class="usage-grid" style="margin-top:12px"><div class="panel"><div class="panel-head"><div class="panel-title">By tool</div></div>${u.byTool.length ? `<div class="utable"><div class="urow uhead tools"><span>Tool</span><span>Calls</span><span>Tokens</span><span>Avg time</span></div>${u.byTool.map(x => `<div class="urow tools"><span class="mono">${escapeHtml(x.tool)}</span><span>${number(x.calls)}</span><span>${fmtTokens(x.responseTokens)}</span><span>${fmtMs(x.ms / x.calls)}</span></div>`).join('')}</div>` : '<div class="small-muted">Nothing yet.</div>'}</div>
      <div class="panel"><div class="panel-head"><div class="panel-title">Recent calls</div></div>${u.recent.length ? `<div class="ulist">${u.recent.slice(0, 12).map(x => `<div class="urow-lite"><span class="mono tool">${escapeHtml(x.tool)}</span><span class="grow muted-ellipsis" title="${escapeHtml(x.query || '')}">${escapeHtml(x.query || '')}</span><span class="mono">${fmtTokens(x.responseTokens)} tok</span><span class="mono">${fmtMs(x.ms)}</span><span class="small-muted">${escapeHtml(timeAgo(x.ts))}</span></div>`).join('')}</div>` : '<div class="small-muted">Nothing yet.</div>'}</div></div>
    <div class="banner info" style="margin-top:12px">${icon('info', 16)}<span>How this is calculated: tokens are estimated as characters ÷ 4. “Without Graf” assumes the agent would open the files Graf pointed to (up to ${number(u.assumptions.maxTokensPerFile)} tokens each) at about ${u.assumptions.msPerFileRead / 1000} s per file. These are estimates, not measurements. The comparison panel above uses real numbers reported by agents.</span></div>`;
  showPageContent(html, seq);
}

/* ==========================================================================
   Code explorer
   ========================================================================== */
function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/'); const name = parts.pop(); let node = root;
    for (const part of parts) { if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] }); node = node.dirs.get(part); }
    node.files.push({ ...f, name });
  }
  return root;
}
const countFiles = node => node.files.length + [...node.dirs.values()].reduce((n, d) => n + countFiles(d), 0);
const fileRow = (f, showPath = false) => `<button type="button" class="tree-row ${f.path === currentSourcePath ? 'active' : ''}" data-action="open-file" data-id="${escapeHtml(f.path)}" data-path="${escapeHtml(f.path)}" title="${escapeHtml(f.path)}"><i class="lang-dot" style="background:${langColor(f.language)}"></i><span class="tr-name">${escapeHtml(showPath ? f.path : f.name)}</span></button>`;
function treeHtml(node, depth = 0) {
  const dirs = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return dirs.map(([name, child]) => `<details class="tree-folder" ${depth < 2 ? 'open' : ''}><summary><span class="caret">${icon('right', 12)}</span>${icon('folderOpen', 15)}<span class="tr-name" style="flex:1">${escapeHtml(name)}</span><span class="small-muted mono">${countFiles(child)}</span></summary><div class="tree-children">${treeHtml(child, depth + 1)}</div></details>`).join('')
    + node.files.sort((a, b) => a.name.localeCompare(b.name)).map(f => fileRow(f)).join('');
}
function renderFileTree(filter = '') {
  const el = $('#fileTreeScroll'); if (!el) return;
  const q = filter.trim().toLowerCase();
  if (q) {
    const hits = currentFiles.filter(f => f.path.toLowerCase().includes(q));
    el.innerHTML = hits.slice(0, 300).map(f => fileRow(f, true)).join('') || '<div class="small-muted" style="padding:12px">No files match.</div>';
  } else el.innerHTML = treeHtml(buildTree(currentFiles)) || '<div class="small-muted" style="padding:12px">No indexed files.</div>';
}
async function renderExplorer() {
  const seq = navSeq;
  currentFiles = await window.graf.project.files();
  const html = `<div class="fill-head">${pageHead('Code Explorer', 'Read-only view of indexed source files. Graf never edits your code.', btn('Reveal project folder', 'open-project-folder', { i: 'folderOpen', s: true }))}</div>
    <div class="file-browser"><aside class="panel flush file-tree"><div class="file-tree-head"><div class="input-icon">${icon('search', 14)}<input id="fileFilter" class="input-sm" placeholder="Filter ${number(currentFiles.length)} files…" aria-label="Filter files"></div></div><div class="file-tree-scroll" id="fileTreeScroll"></div></aside>
    <section class="panel flush source-view" id="sourceView">${emptyState('explorer', 'Select a file', 'Pick a file from the tree to read its source with line numbers and a symbol outline.')}</section></div>`;
  if (!showPageContent(html, seq)) return;
  renderFileTree();
  $('#fileFilter').addEventListener('input', event => renderFileTree(event.target.value));
  if (currentSourcePath && currentFiles.some(f => f.path === currentSourcePath)) await openFile(currentSourcePath);
}
async function openFile(input, startLine = 1, focusLine = null) {
  const filePath = String(input).startsWith('file:') ? String(input).slice(5) : String(input);
  const view = $('#sourceView'); if (!view) return;
  const result = await window.graf.project.readFile(filePath, startLine, 400);
  currentSourcePath = filePath;
  $$('.tree-row').forEach(row => row.classList.toggle('active', row.dataset.path === filePath));
  const file = currentFiles.find(f => f.path === filePath);
  const lang = file?.language || '';
  const parsed = String(result.source ?? '').split('\n').map(raw => { const m = raw.match(/^(\d+): ?(.*)$/); return m ? { n: Number(m[1]), t: m[2] } : { n: 0, t: raw }; });
  const colored = highlightLines(parsed.map(p => p.t), lang);
  const graph = await getGraph().catch(() => ({ nodes: [] }));
  const symbols = graph.nodes.filter(n => n.path === filePath && n.kind !== 'file' && n.lineStart).sort((a, b) => a.lineStart - b.lineStart);
  view.innerHTML = `<div class="source-head">${icon('file', 16)}<span class="sh-path" title="${escapeHtml(filePath)}">${escapeHtml(filePath)}</span>${lang ? `<span class="tag"><i class="lang-dot" style="background:${langColor(lang)}"></i>${escapeHtml(lang)}</span>` : ''}${iconBtn('copy', 'copy-text', 'Copy file path', `data-text="${escapeHtml(filePath)}"`)}${iconBtn('folderOpen', 'reveal-file', 'Reveal in folder', `data-path="${escapeHtml(filePath)}"`)}</div>
    <div class="source-body"><div class="source-code" id="sourceCode">${parsed.map((p, i) => `<div class="source-line ${focusLine === p.n ? 'focus' : ''}"><span class="source-line-number">${p.n || ''}</span><span>${colored[i] || ' '}</span></div>`).join('')}</div>
    <aside class="source-outline"><div class="inspector-section-title"><span>Symbols</span><span>${symbols.length}</span></div>${symbols.map(s => `<button type="button" class="outline-row" data-action="open-file" data-id="${escapeHtml(filePath)}" data-line="${s.lineStart}" title="${escapeHtml(s.signature || s.name)}">${kindIcon(s.kind, 13)}<span class="ol-n">${escapeHtml(s.name)}</span><small>${s.lineStart}</small></button>`).join('') || '<div class="small-muted">No symbols indexed in this file.</div>'}</aside></div>
    <div class="source-paging"><span>Lines ${number(result.lineStart)}–${number(result.lineEnd)} of ${number(result.totalLines)}</span><span class="row-actions">${result.lineStart > 1 ? btn('Previous', 'source-prev', { s: true, i: 'left', a: `data-path="${escapeHtml(filePath)}" data-start="${Math.max(1, result.lineStart - 400)}"` }) : ''}${result.hasMore ? btn('Next', 'source-next', { s: true, a: `data-path="${escapeHtml(filePath)}" data-start="${result.lineEnd + 1}"` }) : ''}</span></div>`;
  $('.source-line.focus')?.scrollIntoView({ block: 'center' });
}

/* ==========================================================================
   Search
   ========================================================================== */
const SEARCH_KINDS = [['', 'All'], ['file', 'Files'], ['function', 'Functions'], ['class', 'Classes'], ['route', 'Routes'], ['memory', 'Memories']];
async function renderSearch() {
  const seq = navSeq;
  const initial = pendingSearch ?? ''; pendingSearch = null;
  const html = `<div class="search-layout">${pageHead('Search', 'Find files, functions, classes, routes and memories across the project.')}
    <div class="search-input-large">${icon('search', 20)}<input id="searchInput" placeholder="Search your codebase…" value="${escapeHtml(initial)}" autocomplete="off" spellcheck="false" aria-label="Search the project"><kbd>Enter</kbd></div>
    <div class="chips" id="searchChips" style="margin-bottom:16px">${SEARCH_KINDS.map(([k, label]) => `<button type="button" class="chip ${searchKind === k ? 'active' : ''}" data-action="search-kind" data-kind="${k}">${k && k !== 'memory' ? kindDot(k) : ''}${label}</button>`).join('')}</div>
    <div id="searchResults"></div></div>`;
  if (!showPageContent(html, seq)) return;
  const input = $('#searchInput');
  let timer;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 200); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { clearTimeout(timer); runSearch(); } });
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  runSearch();
}
function resultRow(n) {
  return `<button type="button" class="result-row" data-action="inspect-node" data-id="${escapeHtml(n.id)}"><span class="result-icon">${kindIcon(n.kind, 16)}</span><span class="result-main"><span class="result-name">${escapeHtml(n.name || n.id)}${kindTag(n.kind)}${n.provenance === 'manual' ? '<span class="tag warning">manual</span>' : ''}</span><span class="result-meta" style="display:block">${escapeHtml(n.path || n.id)}${n.lineStart ? `:${n.lineStart}` : ''}</span>${n.summary ? `<span class="result-summary" style="display:block">${escapeHtml(n.summary)}</span>` : ''}</span><span class="result-go">${icon('right', 16)}</span></button>`;
}
async function runSearch() {
  const box = $('#searchResults'); const input = $('#searchInput'); if (!box || !input) return;
  const query = input.value.trim(); const seq = ++searchSeq;
  if (!query) { box.innerHTML = emptyState('search', 'Search the whole graph', 'Type a file name, function, class, route or memory. Results update as you type.'); return; }
  try {
    let nodes = [], memories = [];
    if (searchKind !== 'memory') nodes = await window.graf.graph.search(query, searchKind || undefined);
    if (!searchKind || searchKind === 'memory') { const q = query.toLowerCase(); memories = (await window.graf.memory.list()).filter(m => m.status !== 'deleted' && `${m.title} ${m.content}`.toLowerCase().includes(q)); }
    if (seq !== searchSeq || !$('#searchResults')) return;
    const total = nodes.length + memories.length;
    box.innerHTML = total ? `<div class="small-muted" style="margin-bottom:10px">${number(total)} result${total === 1 ? '' : 's'}</div><div class="results-list">${nodes.map(resultRow).join('')}${memories.map(m => `<button type="button" class="result-row" data-action="inspect-memory" data-id="${escapeHtml(m.id)}"><span class="result-icon">${kindIcon('memory', 16)}</span><span class="result-main"><span class="result-name">${escapeHtml(m.title)}<span class="result-kind">Memory</span>${statusTag(m.status)}</span><span class="result-summary" style="display:block">${escapeHtml(m.content.slice(0, 200))}${m.content.length > 200 ? '…' : ''}</span></span><span class="result-go">${icon('right', 16)}</span></button>`).join('')}</div>` : emptyState('search', `Nothing found for “${query}”`, 'Try a shorter term, another spelling, or a different type filter.');
  } catch (error) { if (seq === searchSeq && box) box.innerHTML = emptyState('warn', 'Search failed', error.message); }
}

/* ==========================================================================
   Impact analysis
   ========================================================================== */
async function renderImpact() {
  const seq = navSeq;
  const initial = pendingImpact ?? ''; pendingImpact = null;
  const html = `<div class="search-layout">${pageHead('Impact Analysis', 'Trace which nodes depend on a file, function or class before you change it.')}
    <div class="search-input-large">${icon('impact', 20)}<input id="impactInput" placeholder="Symbol name, file path or node ID" value="${escapeHtml(initial)}" autocomplete="off" spellcheck="false" aria-label="Impact target">${btn('Analyze', 'analyze-impact', { v: 'primary' })}</div>
    <div class="banner info">${icon('info', 16)}<span>Impact shows nodes <b>reachable through the graph</b> that depend on the target. It indicates potential blast radius and is not proof that a change will break them.</span></div>
    <div id="impactResult"></div></div>`;
  if (!showPageContent(html, seq)) return;
  $('#impactInput').addEventListener('keydown', event => { if (event.key === 'Enter') runImpact(); });
  if (initial) runImpact(); else { $('#impactInput').focus(); $('#impactResult').innerHTML = emptyState('impact', 'Pick something to analyze', 'Enter a name like “validateSession”, a path like “src/auth.js”, or inspect a node in the graph and choose Impact.'); }
}
async function runImpact() {
  const box = $('#impactResult'); const input = $('#impactInput'); if (!box || !input) return;
  const query = input.value.trim();
  if (!query) return toast('Enter a symbol, file path or node ID.', 'error');
  box.innerHTML = '<div class="loading-line"></div>';
  try {
    const target = await resolveImpactTarget(query, window.graf.graph);
    if (!$('#impactResult')) return;
    if (target.kind === 'not-found') { box.innerHTML = emptyState('search', `No match for “${target.query}”`, 'Search by file path, symbol name or exact node ID.'); return; }
    if (target.kind === 'choices') {
      box.innerHTML = `<div class="small-muted" style="margin-bottom:10px">${number(target.total)} matches — choose one${target.total > target.candidates.length ? ` (showing ${target.candidates.length})` : ''}</div><div class="results-list">${target.candidates.map(n => `<button type="button" class="result-row" data-action="impact-pick" data-id="${escapeHtml(n.id)}"><span class="result-icon">${kindIcon(n.kind, 16)}</span><span class="result-main"><span class="result-name">${escapeHtml(n.name || n.id)}${kindTag(n.kind)}</span><span class="result-meta" style="display:block">${escapeHtml(n.path || n.id)}</span></span><span class="result-go">${icon('right', 16)}</span></button>`).join('')}</div>`;
      return;
    }
    await showImpactFor(target.id);
  } catch (error) { if ($('#impactResult')) box.innerHTML = emptyState('warn', 'Analysis failed', error.message); }
}
async function showImpactFor(id) {
  const box = $('#impactResult'); if (!box) return;
  const [impact, node] = await Promise.all([window.graf.graph.impact(id), window.graf.graph.node(id)]);
  const items = impact.affected || [];
  const byKind = {}; for (const i of items) (byKind[i.kind] ||= []).push(i);
  const files = new Set(items.map(i => i.path).filter(Boolean));
  const manual = items.filter(i => i.provenance === 'manual').length;
  box.innerHTML = `<div class="panel" style="margin-bottom:14px"><div class="panel-head" style="margin:0"><div class="result-name">${kindIcon(node.kind, 18)}${escapeHtml(node.name || node.id)}${kindTag(node.kind)}</div><div class="row-actions">${btn('Inspect in graph', 'inspect-node', { s: true, i: 'graph', a: `data-id="${escapeHtml(id)}"` })}${node.path ? btn('View source', 'view-source', { s: true, i: 'code', a: `data-id="${escapeHtml(id)}"` }) : ''}</div></div><div class="result-meta">${escapeHtml(node.path || node.id)}</div></div>
    <div class="impact-summary"><div class="mini-stat"><small>Affected nodes</small><strong>${number(items.length)}${impact.more ? '+' : ''}</strong></div><div class="mini-stat"><small>Files touched</small><strong>${number(files.size)}</strong></div><div class="mini-stat"><small>Node types</small><strong>${number(Object.keys(byKind).length)}</strong></div><div class="mini-stat"><small>Human-linked</small><strong>${number(manual)}</strong></div></div>
    ${impact.more ? `<div class="banner warn">${icon('warn', 16)}<span>The graph reaches more nodes than are shown. Listing the first ${number(items.length)}.</span></div>` : ''}
    ${items.length ? Object.entries(byKind).sort((a, b) => b[1].length - a[1].length).map(([kind, list]) => `<div class="impact-group"><h4>${kindIcon(kind, 14)}${escapeHtml(kindInfo(kind).label)}<span class="tag">${list.length}</span></h4><div class="results-list">${list.map(i => `<button type="button" class="result-row" data-action="inspect-node" data-id="${escapeHtml(i.id)}"><span class="result-main"><span class="result-name">${escapeHtml(i.name)}<span class="tag mono">${escapeHtml(i.via)}</span><span class="tag ${i.provenance === 'verified' ? 'success' : ''}">${escapeHtml(i.provenance || '')}</span></span><span class="result-meta" style="display:block">${escapeHtml(i.path || i.id)}</span></span><span class="result-go">${icon('right', 16)}</span></button>`).join('')}</div></div>`).join('') : emptyState('ok', 'Nothing depends on this', 'No other graph nodes reference this target. It looks safe to change in isolation, but verify with your tests.')}`;
}

/* ==========================================================================
   Context studio
   ========================================================================== */
function formatContext(result, format = 'markdown') {
  const data = result?.context || {};
  if (format === 'json') return JSON.stringify(data, null, 2);
  const lines = [`# Graf context: ${result?.query || ''}`, '', '## Relevant code'];
  for (const node of (data.results || [])) {
    lines.push('', `### ${node.name || node.id}`, `- Type: ${node.kind || 'unknown'}`, `- ID: ${node.id}`);
    if (node.path) lines.push(`- Path: ${node.path}`);
    if (node.provenance) lines.push(`- Provenance: ${node.provenance}`);
    if (node.summary) lines.push('', node.summary);
    if (node.edges?.length) { lines.push('', 'Relationships:'); for (const edge of node.edges) lines.push(`- ${edge.type}: ${edge.name} (${edge.id})`); }
  }
  if (data.memories?.length) { lines.push('', '## Active project memories'); for (const memory of data.memories) lines.push('', `### ${memory.title}`, memory.content); }
  if (!data.results?.length && !data.memories?.length) lines.push('', 'No matching code nodes or memories were found.');
  return lines.join('\n');
}
async function renderContext() {
  const seq = navSeq;
  const html = `${pageHead('Context Studio', 'Assemble focused, source-derived context for an AI agent — within a budget you control.')}
    <div class="split-layout"><div class="panel"><div class="panel-title" style="margin-bottom:14px">Build context</div>
      <div class="field"><label for="contextQuery">Task or search query</label><textarea id="contextQuery" placeholder="e.g. Update the login flow and identify dependent code" rows="5">${escapeHtml(lastContext?.query || '')}</textarea></div>
      <div class="field"><label for="contextBudget">Token budget</label><input id="contextBudget" type="number" min="200" max="12000" step="100" value="${lastContext?.maxTokens || 1200}"><div class="chips" style="margin-top:4px">${[[600, 'Compact'], [1200, 'Balanced'], [2400, 'Detailed'], [4000, 'Deep']].map(([n, l]) => `<button type="button" class="chip" data-action="context-preset" data-n="${n}">${l} · ${number(n)}</button>`).join('')}</div></div>
      <label class="settings-row" style="padding:10px 0"><span><strong>Include dependencies</strong><small>Add relationships of matched nodes.</small></span><span class="switch"><input type="checkbox" id="contextDependencies" checked><i></i></span></label>
      <label class="settings-row" style="padding:10px 0"><span><strong>Include active memory</strong><small>Add relevant approved memories.</small></span><span class="switch"><input type="checkbox" id="contextMemory" checked><i></i></span></label>
      <div style="margin-top:16px">${btn('Build context', 'build-context', { v: 'primary', i: 'sparkles', a: 'id="buildContextButton"' })}</div></div>
      <div class="panel"><div class="panel-head"><div><div class="panel-title">Preview</div><div class="panel-sub" id="contextMeta">Nothing generated yet.</div></div><div class="row-actions"><select id="contextFormat" class="input-sm" style="width:auto" aria-label="Export format"><option value="markdown">Markdown</option><option value="json">JSON</option></select>${btn('Copy', 'copy-context', { s: true, i: 'copy' })}${btn('Save', 'save-context', { s: true, i: 'download' })}</div></div><div id="contextMeter"></div><pre class="context-output placeholder" id="contextOutput" style="margin:12px 0 0">Describe a task and choose Build context to preview what an agent would receive.</pre></div></div>`;
  if (!showPageContent(html, seq)) return;
  if (lastContext) renderContextPreview();
}
function renderContextPreview() {
  if (!lastContext) return;
  const format = $('#contextFormat')?.value || 'markdown';
  const out = $('#contextOutput'); if (!out) return;
  out.classList.remove('placeholder'); out.textContent = formatContext(lastContext, format);
  const used = lastContext.estimatedTokens || 0; const budget = lastContext.maxTokens || 1;
  $('#contextMeta').textContent = `${number(used)} estimated tokens of ${number(budget)} · ${lastContext.truncated ? 'truncated to fit budget' : 'complete'}`;
  $('#contextMeter').innerHTML = `<div class="meter"><i class="${used > budget ? 'over' : ''}" style="width:${Math.min(100, used / budget * 100)}%"></i></div>`;
}

/* ==========================================================================
   Memory
   ========================================================================== */
const isHuman = m => ['developer', 'human'].includes(m.source);
function memoryCard(m) {
  const id = escapeHtml(m.id); const a = `data-id="${id}"`;
  return `<article class="memory-card" id="memory-card-${id}" data-search="${escapeHtml(`${m.title} ${m.content}`.toLowerCase())}"><div class="card-top"><div class="memory-title">${escapeHtml(m.title)}</div>${statusTag(m.status)}</div><div class="memory-content">${escapeHtml(m.content)}</div>${m.linkedNodes?.length ? `<div class="linked-nodes">${m.linkedNodes.slice(0, 6).map(n => `<span class="tag" data-action="inspect-node" data-id="${escapeHtml(n)}" title="${escapeHtml(n)}">${icon('link', 11)}${escapeHtml(shortId(n.split('#').pop() || n, 26))}</span>`).join('')}</div>` : ''}<div class="muted-meta"><span>${icon(isHuman(m) ? 'user' : 'cpu', 12)} ${isHuman(m) ? 'You' : escapeHtml(cap(m.source || 'agent'))}</span><span>${escapeHtml(fmtDate(m.createdAt))}</span>${m.approvedBy ? `<span>Approved by ${escapeHtml(m.approvedBy)}</span>` : ''}${m.supportingEvidence?.length ? `<span>${m.supportingEvidence.length} evidence</span>` : ''}</div><div class="card-foot">${m.status === 'pending' ? btn('Approve', 'approve-memory', { v: 'primary', s: true, i: 'check', a }) : ''}${m.status === 'active' ? btn('Archive', 'archive-memory', { s: true, a }) : ''}${m.status !== 'deleted' ? btn('Edit', 'edit-memory', { s: true, i: 'edit', a }) : ''}${btn('Delete', 'delete-memory', { s: true, v: 'ghost', i: 'trash', a })}</div></article>`;
}
async function renderMemory() {
  const seq = navSeq;
  const memories = (await window.graf.memory.list()).filter(m => m.status !== 'deleted');
  const n = s => memories.filter(m => m.status === s).length;
  const tabs = [['all', 'All', memories.length], ['pending', 'Pending review', n('pending')], ['active', 'Active', n('active')], ['archived', 'Archived', n('archived')]];
  const filtered = memoryTab === 'all' ? memories : memories.filter(m => m.status === memoryTab);
  const html = `${pageHead('Memory', 'Decisions and knowledge your agents can rely on, stored locally. Agent-written memories wait for your approval.', btn('Add memory', 'add-memory', { v: 'primary', i: 'plus' }))}
    <div class="tab-row" role="tablist">${tabs.map(([id, label, count]) => `<button type="button" role="tab" class="tab ${memoryTab === id ? 'active' : ''}" aria-selected="${memoryTab === id}" data-action="memory-tab" data-tab="${id}">${label}<span class="tab-n">${count}</span></button>`).join('')}<span style="flex:1"></span><div class="input-icon" style="width:240px;align-self:center;margin-bottom:4px">${icon('search', 14)}<input id="memoryFilter" class="input-sm" placeholder="Filter memories…" value="${escapeHtml(memoryQuery)}" aria-label="Filter memories"></div></div>
    ${filtered.length ? `<div class="card-grid" id="memoryGrid">${filtered.map(memoryCard).join('')}</div><div id="memoryNoMatch" class="hidden">${emptyState('search', 'No memories match your filter')}</div>` : emptyState('memory', memoryTab === 'all' ? 'No memories yet' : `No ${memoryTab} memories`, memoryTab === 'pending' ? 'Memories proposed by connected agents appear here for review.' : 'Capture a decision, convention or gotcha so every future agent session starts informed.', memoryTab === 'pending' ? '' : btn('Add memory', 'add-memory', { v: 'primary', i: 'plus' }))}`;
  if (!showPageContent(html, seq)) return;
  const apply = () => {
    const q = $('#memoryFilter').value.trim().toLowerCase(); memoryQuery = $('#memoryFilter').value; let shown = 0;
    $$('.memory-card').forEach(card => { const hit = !q || card.dataset.search.includes(q); card.classList.toggle('hidden', !hit); if (hit) shown++; });
    $('#memoryNoMatch')?.classList.toggle('hidden', shown > 0 || !q);
  };
  $('#memoryFilter').addEventListener('input', apply); apply();
}

/* ==========================================================================
   History
   ========================================================================== */
function renderDiffDetails(diff) {
  const groups = [
    ['Nodes added', 'added', diff.changes?.added || [], n => `${n.name || n.id} · ${n.kind || 'node'} · ${n.path || 'manual'}`],
    ['Nodes removed', 'removed', diff.changes?.removed || [], n => `${n.name || n.id} · ${n.kind || 'node'} · ${n.path || 'manual'}`],
    ['Nodes modified', 'modified', diff.changes?.modified || [], n => `${n.after?.name || n.before?.name || n.after?.id} · ${n.after?.path || n.before?.path || 'manual'}`],
    ['Relationships added', 'edgesAdded', diff.changes?.edges?.added || [], e => `${e.src} → ${e.dst} · ${e.type}`],
    ['Relationships removed', 'edgesRemoved', diff.changes?.edges?.removed || [], e => `${e.src} → ${e.dst} · ${e.type}`],
    ['Relationships modified', 'edgesModified', diff.changes?.edges?.modified || [], e => `${e.after?.src || e.before?.src} → ${e.after?.dst || e.before?.dst} · ${e.after?.type || e.before?.type}`]
  ];
  return groups.map(([title, key, items, label]) => `<section class="diff-section"><div class="panel-title">${title}<span class="tag">${number(diff.counts?.[key] || 0)}</span></div>${items.length ? `<ul>${items.slice(0, 30).map(item => `<li>${escapeHtml(label(item))}</li>`).join('')}</ul>${items.length > 30 ? `<div class="small-muted" style="margin-top:6px">Showing 30 of ${items.length}. Export the graph for the full record.</div>` : ''}` : '<div class="small-muted" style="margin-top:8px">No changes.</div>'}</section>`).join('');
}
async function renderHistory() {
  const seq = navSeq;
  const [snapshots, changes] = await Promise.all([window.graf.history.list(), window.graf.changes.list()]);
  const recent = [...changes].reverse().slice(0, 14);
  const html = `${pageHead('History', 'Versioned graph knowledge. Restoring creates a safety snapshot first and never touches your source files.', btn('Create snapshot', 'create-snapshot', { v: 'primary', i: 'camera' }))}
    <div class="dashboard-grid"><div><div class="section-label">Snapshots</div><div class="timeline">${snapshots.map(s => `<div class="snapshot-card"><div class="card-top"><div><div class="memory-title">${escapeHtml(s.label || `Version ${s.number}`)}</div><div class="muted-meta" style="margin-top:4px"><span>${escapeHtml(fmtDate(s.createdAt))}</span>${s.branch ? `<span>${icon('branch', 11)} ${escapeHtml(s.branch)}</span>` : ''}${s.commit ? `<span class="mono">${escapeHtml(s.commit.slice(0, 8))}</span>` : ''}</div></div><span class="sc-n">v${s.number}</span></div><div class="row-actions"><span class="tag">${number(s.nodeCount)} nodes</span><span class="tag">${number(s.edgeCount)} edges</span><span style="flex:1"></span>${btn('Diff', 'snapshot-diff', { s: true, i: 'diff', a: `data-id="${escapeHtml(s.id)}"` })}${btn('Restore', 'snapshot-restore', { s: true, i: 'restore', a: `data-id="${escapeHtml(s.id)}"` })}</div></div>`).join('') || emptyState('camera', 'No snapshots yet', 'Create a checkpoint to start versioning your graph knowledge.', btn('Create snapshot', 'create-snapshot', { v: 'primary', i: 'camera' }))}</div></div>
      <div><div class="section-label">Recent graph changes</div><div class="panel">${recent.map(c => `<div class="activity-row"><div class="activity-symbol">${icon(ACTIVITY_ICON[c.cause] || 'diff', 15)}</div><div class="activity-copy"><strong>${escapeHtml(cap(c.cause))} · ${escapeHtml(c.entity)}</strong><small>${escapeHtml(c.entityId)}</small></div><div class="activity-time">${escapeHtml(timeAgo(c.ts))}</div></div>`).join('') || '<div class="small-muted">No changes recorded.</div>'}</div></div></div>
    <div id="historyDiff" style="margin-top:14px"></div>`;
  showPageContent(html, seq);
}

/* ==========================================================================
   Proposals
   ========================================================================== */
async function renderProposals() {
  const seq = navSeq;
  const proposals = await window.graf.proposals.list();
  const n = s => proposals.filter(p => p.status === s).length;
  const tabs = [['pending', 'Pending', n('pending')], ['approved', 'Approved', n('approved')], ['rejected', 'Rejected', n('rejected')], ['all', 'All', proposals.length]];
  const list = proposalTab === 'all' ? proposals : proposals.filter(p => p.status === proposalTab);
  const html = `${pageHead('Proposals', 'Review suggestions from connected agents before they change Graf’s human-maintained layer. Source-derived data is never modified.')}
    <div class="tab-row" role="tablist">${tabs.map(([id, label, count]) => `<button type="button" role="tab" class="tab ${proposalTab === id ? 'active' : ''}" aria-selected="${proposalTab === id}" data-action="proposal-tab" data-tab="${id}">${label}<span class="tab-n">${count}</span></button>`).join('')}</div>
    ${list.length ? `<div class="card-grid">${list.map(p => { const a = `data-id="${escapeHtml(p.id)}"`; const pct = Math.round((p.confidence || 0) * 100); return `<article class="proposal-card"><div class="card-top"><div class="proposal-title">${escapeHtml(p.rationale || 'Agent proposal')}</div>${statusTag(p.status)}</div><div class="memory-content">${escapeHtml(p.expectedImpact || 'No expected impact supplied.')}</div><div><div class="muted-meta"><span>Confidence ${pct}%</span><span>${(p.changes || []).length} proposed change${(p.changes || []).length === 1 ? '' : 's'}</span></div><div class="meter"><i style="width:${pct}%"></i></div></div><details class="proposal-details"><summary>${icon('right', 13)}Review proposed changes</summary><pre>${escapeHtml(JSON.stringify(p.changes || [], null, 2))}</pre>${p.evidence?.length ? `<div class="panel-sub">Evidence: ${escapeHtml(p.evidence.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' · '))}</div>` : '<div class="panel-sub">No supporting evidence attached.</div>'}</details><div class="muted-meta"><span class="mono">${escapeHtml(shortId(p.id, 30))}</span><span>${escapeHtml(fmtDate(p.createdAt))}</span></div>${p.status === 'pending' ? `<div class="card-foot">${btn('Approve supported changes', 'approve-proposal', { v: 'primary', s: true, i: 'check', a })}${btn('Reject', 'reject-proposal', { s: true, a })}</div>` : ''}</article>`; }).join('')}</div>` : emptyState('proposals', proposalTab === 'pending' ? 'Nothing waiting for review' : 'No proposals here', 'When a connected agent suggests a change to project knowledge, it will appear here for your approval.', btn('Connect an agent', 'nav-integrations', { i: 'integrations' }))}`;
  showPageContent(html, seq);
}

/* ==========================================================================
   Integrations / diagnostics / settings
   ========================================================================== */
const CLIENT_ICON = { antigravity: 'A', 'antigravity-workspace': 'A', cursor: 'C' };
const CLIENT_SVG = { 'claude-desktop': 'sparkles', 'claude-code': 'terminal', vscode: 'code' };
const hasProjectNow = () => Boolean(activeProject);
async function renderIntegrations() {
  const seq = navSeq;
  const state = await window.graf.integrations.status();
  const cmds = hasProjectNow() ? await window.graf.integrations.commandsStatus().catch(() => null) : null;
  const rt = state.runtime || {};
  const hasProject = Boolean(activeProject);
  const card = c => {
    const attrs = `data-client="${escapeHtml(c.client)}" data-label="${escapeHtml(c.label)}"`;
    const blocked = !hasProject ? 'Open a project first.' : !rt.ok ? 'Fix the Node.js problem above first.' : '';
    let tag, desc, actions;
    if (c.grafConfigured) {
      tag = '<span class="tag success">Connected</span>';
      desc = 'Graf is configured for this client. Restart it to reload MCP servers.';
      actions = `${btn('Disconnect', 'disconnect-mcp', { s: true, a: attrs })}${btn('Reconnect', 'connect-mcp', { s: true, i: 'sync', a: `${attrs} ${blocked ? 'disabled' : ''}` })}`;
    } else if (c.installed) {
      tag = '<span class="tag">Installed</span>';
      desc = escapeHtml(c.installEvidence || 'Found on this computer.');
      actions = `${btn('Connect', 'connect-mcp', { s: true, v: 'primary', i: 'plus', a: `${attrs} ${blocked ? 'disabled' : ''}` })}${btn('Set up manually', 'manual-mcp', { s: true, a: `${attrs} ${hasProject ? '' : 'disabled'}` })}`;
    } else {
      tag = '<span class="tag warning">Not installed</span>';
      desc = `${escapeHtml(c.label.split(' · ')[0])} was not found on this computer. Install it first, or set it up by hand if it lives somewhere unusual.`;
      actions = `${btn('Set up manually', 'manual-mcp', { s: true, v: 'primary', a: `${attrs} ${hasProject ? '' : 'disabled'}` })}${btn('Connect anyway', 'connect-anyway', { s: true, a: `${attrs} ${blocked ? 'disabled' : ''}` })}`;
    }
    return `<div class="integration-card${c.installed || c.grafConfigured ? '' : ' is-missing'}"><div class="integration-icon">${CLIENT_SVG[c.client] ? icon(CLIENT_SVG[c.client], 20) : escapeHtml(CLIENT_ICON[c.client] || c.label[0])}</div><div style="min-width:0"><div class="integration-title">${escapeHtml(c.label)}${tag}</div><div class="integration-desc">${desc}<br><span class="mono" title="${escapeHtml(c.configPath || '')}">${escapeHtml(formatDisplayPath(c.configPath) || (c.needsProject ? 'Needs an open project to choose the config location' : 'Unknown location'))}</span>${c.note ? `<br><span class="small-muted">${escapeHtml(c.note)}</span>` : ''}${c.parseError ? `<br><span class="danger-text">${escapeHtml(c.parseError)}</span>` : ''}${blocked && (c.installed || c.grafConfigured) ? `<br><span class="small-muted">${escapeHtml(blocked)}</span>` : ''}</div></div><div class="integration-actions">${actions}</div></div>`;
  };
  const installed = (state.clients || []).filter(c => c.installed || c.grafConfigured), missing = (state.clients || []).filter(c => !(c.installed || c.grafConfigured));
  const html = `${pageHead('Integrations', 'Connect Graf to the coding agents installed on this computer. Config files are backed up before any change and other MCP servers are kept.', btn('Re-scan', 'rescan-integrations', { s: true, i: 'sync' }))}
    ${hasProject ? '' : `<div class="banner warn">${icon('warn', 16)}<span>No project is open. Open a project first so Graf knows which folder to serve to your agents.</span>${btn('Choose project', 'nav-projects', { s: true })}</div>`}
    <div class="panel integration-runtime"><div><div class="panel-title">${icon('cpu', 16)}Node.js runtime</div><div class="panel-sub">Your agents start Graf as a local process using Node.js. Nothing leaves this computer.</div><div class="muted-meta" style="margin-top:8px"><span class="tag ${rt.ok ? 'success' : 'danger'}">${rt.ok ? `Node ${escapeHtml(rt.version || '')}` : 'Not ready'}</span><span class="tag">${escapeHtml(({ bundled: 'Bundled with Graf', system: 'Found on your PATH', override: 'From GRAF_NODE_PATH', missing: 'Not found' })[rt.source] || '')}</span>${rt.path ? `<span class="mono" title="${escapeHtml(rt.path)}">${escapeHtml(formatDisplayPath(rt.path))}</span>` : ''}</div>${rt.ok ? '' : `<div class="danger-text" style="margin-top:8px">${escapeHtml(rt.problem || 'Node.js is not available.')}</div>`}</div><div class="row-actions">${btn('Test runtime', 'test-runtime', { s: true, i: 'terminal' })}${btn('Run live MCP handshake', 'test-mcp', { s: true, v: 'primary', i: 'zap', a: hasProject ? '' : 'disabled' })}</div></div>
${hasProject && cmds ? commandsPanel(cmds, (state.clients || []).find(c => c.client === 'antigravity')) : ''}
    <div class="section-label">Found on this computer (${installed.length})</div>${installed.map(card).join('') || '<div class="small-muted" style="margin:6px 0 14px">None of the supported agents were found. Install one, then press Re-scan.</div>'}
    ${missing.length ? `<div class="section-label">Not found (${missing.length})</div>${missing.map(card).join('')}` : ''}
    <div class="banner info" style="margin-top:6px">${icon('info', 16)}<span>After connecting, restart the agent so it reloads its MCP configuration. Graf cannot control other applications.</span></div>`;
  showPageContent(html, seq);
}
const COMMAND_STATE = { installed: ['success', 'Installed'], outdated: ['warning', 'Update available'], missing: ['', 'Not installed'], foreign: ['danger', 'Your own file, left alone'] };
function commandsPanel(cmds, ag) {
  const flows = cmds.items.filter(i => i.kind === 'workflow'), rule = cmds.items.find(i => i.kind === 'rule');
  const anyInstalled = cmds.items.some(i => i.state === 'installed' || i.state === 'outdated');
  const needsWork = flows.some(i => i.state === 'missing' || i.state === 'outdated');
  return `<div class="panel commands-panel"><div class="panel-head"><div><div class="panel-title">${icon('terminal', 16)}Antigravity slash commands</div><div class="panel-sub">Type these in the Antigravity chat. They tell the agent to use Graf’s graph instead of scanning your files. They guide the agent; they cannot force it.</div></div><span class="tag ${ag?.installed ? 'success' : 'warning'}">${ag?.installed ? 'Antigravity found' : 'Antigravity not found'}</span></div>
    <div class="cmd-list">${flows.map(i => `<div class="cmd-row"><span class="mono cmd-name">${escapeHtml(i.command)}</span><span class="cmd-desc">${escapeHtml(i.description)}</span><span class="tag ${COMMAND_STATE[i.state][0]}">${COMMAND_STATE[i.state][1]}</span></div>`).join('')}
      <div class="cmd-row"><span class="mono cmd-name">Always-on rule</span><span class="cmd-desc">${escapeHtml(rule.description)} Optional: applies to every chat in this project.</span><span class="tag ${COMMAND_STATE[rule.state][0]}">${COMMAND_STATE[rule.state][1]}</span></div></div>
    <label class="toggle cmd-rule"><span class="switch"><input type="checkbox" id="cmdRule" ${rule.state === 'installed' || rule.state === 'outdated' ? 'checked' : ''}><i></i></span>Also add the always-on rule</label>
    <div class="row-actions">${btn(anyInstalled ? (needsWork ? 'Update commands' : 'Reinstall commands') : 'Install commands', 'commands-install', { v: 'primary', s: true, i: 'download' })}${anyInstalled ? btn('Remove', 'commands-remove', { s: true, i: 'trash' }) : ''}</div>
    <div class="small-muted" style="margin-top:10px">Files go in <span class="mono" title="${escapeHtml(cmds.baseDir)}">${escapeHtml(formatDisplayPath(cmds.baseDir))}</span> (skills/ and rules/). Graf only changes files it created and never overwrites yours. If a command does not appear after typing “/”, open Customizations → Workflows in Antigravity.</div></div>`;
}
async function connectClient(ds, force) {
  const r = await window.graf.integrations.configure(ds.client, { force });
  let note = '';
  try { const check = await window.graf.integrations.testMcp(); note = ` · ${check.toolCount} MCP tools verified`; } catch (error) { note = ` · but the live check failed: ${error.message}`; }
  toast(`${r.label} configured${note}. Restart it to load Graf.`, note.includes('failed') ? 'error' : 'success');
  await renderIntegrations();
}
async function showManualSetup(ds) {
  const m = await window.graf.integrations.manual(ds.client);
  await modalPromise({
    eyebrow: 'MANUAL SETUP', title: `Add Graf to ${m.label}`,
    body: `<ol class="manual-steps">${m.steps.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol>
      <div class="field"><label>Config file</label><div class="code-inline" style="display:block;word-break:break-all">${escapeHtml(formatDisplayPath(m.configPath))}</div><div class="small-muted">${m.configExists ? 'This file already exists. Merge, do not replace.' : m.configDirExists ? 'The file does not exist yet. Create it.' : 'The folder does not exist yet. Create it along with the file.'}</div></div>
      <div class="field"><label>Add this</label><pre class="manual-snippet" id="manualSnippet">${escapeHtml(m.snippet)}</pre></div>
      ${m.runtimeFound ? '' : '<div class="danger-text">Node.js was not found, so “node” above is a placeholder. Install Node.js 22.5+ first.</div>'}`,
    actions: `<button type="button" class="button button-ghost" data-action="modal-cancel">Close</button><button type="button" class="button button-primary" id="modalConfirm">Copy snippet</button>`
  }, finish => {
    $('#modalConfirm').onclick = async () => { toast((await copyText(m.snippet)) ? 'Snippet copied.' : 'Copy failed. Select the text and copy it by hand.', 'info'); };
  });
}
async function renderDiagnostics() {
  const seq = navSeq;
  const d = await window.graf.project.diagnostics();
  const mb = b => `${(b / 1024 / 1024).toFixed(2)} MB`;
  const healthy = d.integrity === 'ok';
  const items = [['Application', `v${d.appVersion}`, 'info'], ['Platform', `${d.platform} · ${d.arch}`, 'cpu'], ['Node runtime', d.nodeVersion, 'terminal'], ['Database', d.database, 'database'], ['Integrity', d.integrity, healthy ? 'ok' : 'warn'], ['Files', number(d.graph.files), 'file'], ['Nodes', number(d.graph.nodes), 'graph'], ['Edges', number(d.graph.edges), 'link'], ['Stale files', number(d.graph.staleFiles), 'clock'], ['Memories', number(d.memoryCount), 'memory'], ['Pending memories', number(d.pendingMemories), 'memory'], ['Proposals', number(d.proposalCount), 'proposals'], ['Notes', number(d.notesCount), 'note'], ['Pinned nodes', number(d.pinCount), 'pin'], ['SQLite size', mb(d.databaseBytes), 'database'], ['JSON mirror', mb(d.mirrorBytes), 'file']];
  const html = `${pageHead('Diagnostics', 'Inspect the local engine, database integrity and recovery state.', btn('Refresh checks', 'refresh-diagnostics', { v: 'primary', i: 'sync' }))}
    <div class="banner ${healthy ? 'info' : 'bad'}">${icon(healthy ? 'ok' : 'warn', 16)}<span>${healthy ? 'Database integrity check passed. The local graph is healthy.' : `Database integrity check reported: ${escapeHtml(d.integrity)}. Create a backup and consider a full rebuild.`}</span></div>
    <div class="diagnostic-grid">${items.map(([k, v, ic]) => `<div class="diagnostic-card ${k === 'Integrity' && healthy ? 'ok' : ''}"><small>${icon(ic, 13)}${escapeHtml(k)}</small><strong>${escapeHtml(v)}</strong></div>`).join('')}</div>
    <div class="panel" style="margin-top:14px"><div class="panel-title" style="margin-bottom:12px">${icon('database', 16)}Local storage</div>
      <div class="kv"><span>SQLite database</span><span class="code-inline">${escapeHtml(d.dbPath)}</span></div>
      <div class="kv"><span>JSON recovery mirror</span><span class="code-inline">${escapeHtml(d.jsonMirror)}</span></div>
      <div class="row-actions" style="margin-top:16px">${btn('Open .graf folder', 'open-folder', { i: 'folderOpen', s: true, a: `data-path="${escapeHtml(d.dbPath.replace(/[\\/][^\\/]+$/, ''))}"` })}${btn('Create backup', 'backup-project', { i: 'download', s: true, v: 'primary' })}${btn('Restore backup', 'restore-backup', { i: 'upload', s: true })}${btn('Export graph JSON', 'export-json', { i: 'file', s: true })}${btn('Export architecture', 'export-markdown', { i: 'file', s: true })}</div>
      <div class="small-muted" style="margin-top:12px">Backups copy the repository’s .graf directory. Restoring keeps a safety copy of the current graph. Source files are never changed.</div></div>`;
  showPageContent(html, seq);
}
const SETTINGS_TABS = [['general', 'General', 'settings'], ['projects', 'Projects', 'projects'], ['indexing', 'Indexing', 'sync'], ['privacy', 'Privacy', 'shield'], ['shortcuts', 'Shortcuts', 'command'], ['about', 'About', 'info']];
async function renderSettings() {
  const seq = navSeq;
  appPreferences = await window.graf.preferences.get();
  const info = await window.graf.appInfo().catch(() => ({}));
  const html = `${pageHead('Settings', 'Configure how Graf runs on this computer.')}<div class="settings-layout"><div class="panel settings-nav" role="tablist">${SETTINGS_TABS.map(([id, label, ic]) => `<button type="button" role="tab" class="${settingsTab === id ? 'active' : ''}" aria-selected="${settingsTab === id}" data-action="settings-tab" data-tab="${id}">${icon(ic, 16)}${label}</button>`).join('')}</div><div class="panel settings-content" id="settingsContent">${settingsContent(info)}</div></div>`;
  showPageContent(html, seq);
}
const toggleRow = (title, desc, setting, checked, disabled = false) => `<label class="settings-row"><span><strong>${title}</strong><small>${desc}</small></span><span class="switch"><input type="checkbox" data-setting="${setting}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><i></i></span></label>`;
const infoRow = (title, desc, right = '') => `<div class="settings-row"><span><strong>${title}</strong><small>${desc}</small></span>${right}</div>`;
function settingsContent(info = {}) {
  if (settingsTab === 'general') return `<div class="panel-title">General</div>${toggleRow('Start Graf when I sign in', 'Register Graf in the operating system’s login items.', 'startOnLogin', appPreferences.login?.openAtLogin, !appPreferences.loginItemAvailable)}${toggleRow('Close to system tray', 'Closing the window hides Graf. Use the tray menu to quit completely.', 'closeToTray', appPreferences.closeToTray, !appPreferences.trayAvailable)}${infoRow('Appearance', 'Graf uses a dark interface designed for long sessions.', '<span class="tag">Dark</span>')}`;
  if (settingsTab === 'projects') return `<div class="panel-title">Projects and storage</div>${infoRow('Project registry', 'Stored in Graf’s application data directory.', '<span class="tag success">Local</span>')}${infoRow('Graph database', 'Each repository keeps its own .graf directory with SQLite and a JSON recovery mirror.', '<span class="tag">Per project</span>')}${infoRow('Project removal', 'Removing a project only removes its registry entry. Repository files and .graf data are kept.', '<span class="tag success">Non-destructive</span>')}${infoRow('Manage projects', 'Open, rename, re-index or remove registered projects.', btn('Open Projects', 'nav-projects', { s: true, i: 'projects' }))}`;
  if (settingsTab === 'indexing') return `<div class="panel-title">Indexing</div>${infoRow('Full rebuild', 'Re-parse every supported source file. Human notes and memories are preserved.', btn('Rebuild graph', 'rebuild-graph', { s: true, i: 'restore', d: !activeProject }))}${infoRow('Ignore rules', 'Graf respects .gitignore and .grafignore. Edit .grafignore to exclude more paths; Graf never modifies .gitignore.', btn('Edit .grafignore', 'edit-grafignore', { s: true, i: 'edit', d: !activeProject }))}${infoRow('Supported parsers', 'JavaScript, TypeScript, Python, Java, YAML and .env files. Extraction is heuristic, and inferred edges are labelled as such.', '<span class="tag">Heuristic</span>')}`;
  if (settingsTab === 'privacy') return `<div class="panel-title">Privacy and security</div>${infoRow('Local-first storage', 'Graph, memories, snapshots, layouts and preferences stay on this device.', '<span class="tag success">Enabled</span>')}${infoRow('Telemetry', 'This build does not include telemetry or analytics.', '<span class="tag success">Off</span>')}${infoRow('Cloud processing', 'Graf does not send source code to any external AI service.', '<span class="tag success">Off</span>')}${infoRow('Secret detection', 'Values that look like credentials are redacted before they reach the graph.', '<span class="tag success">Active</span>')}`;
  if (settingsTab === 'shortcuts') return `<div class="panel-title">Keyboard shortcuts</div><div class="shortcut-list">${[['Ctrl K', 'Search and command palette'], ['Ctrl Shift P', 'Command palette'], ['Ctrl B', 'Toggle sidebar'], ['Ctrl G', 'Project Tree'], ['Ctrl 1', 'Overview'], ['Ctrl 2', 'Project Tree'], ['Ctrl 3', 'Usage & Savings'], ['Ctrl 4', 'Graph Explorer'], ['Esc', 'Close menus and dialogs']].map(([k, l]) => `<div class="shortcut-row"><span>${l}</span><kbd>${k}</kbd></div>`).join('')}</div>`;
  return `<div class="panel-title">About Graf</div><p class="small-muted" style="margin:4px 0 8px">Your codebase has a memory now.</p>${infoRow('Graf Desktop', `Electron ${escapeHtml(info.electronVersion || '')} · Graf Core 0.2.4`, `<span class="tag">v${escapeHtml(info.version || '1.0.1')}</span>`)}${infoRow('Architecture', 'Electron · Cytoscape.js · SQLite · MCP over stdio')}${infoRow('Typeface', 'Geist and Geist Mono by Vercel, bundled under the SIL Open Font License.')}${infoRow('Privacy', 'Local-first. No account, telemetry or hosted backend.')}`;
}

/* ==========================================================================
   Actions (shared by buttons, shortcuts and the command palette)
   ========================================================================== */
async function pickAndAddProject() {
  const chosen = await window.graf.projects.choose();
  if (!chosen) return;
  await window.graf.projects.add(chosen);
  await openProject(chosen);
}
async function focusNode(id) {
  selectedNode = id;
  if (activePage === 'graph' && cy) {
    const n = cy.getElementById(id);
    if (n.nonempty()) {
      cy.elements().removeClass('dim hl'); cy.nodes().unselect(); n.select();
      cy.elements().not(n.closedNeighborhood()).addClass('dim'); n.connectedEdges().addClass('hl');
      cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1.1) }, { duration: 280 });
      return showNodeInspector(id);
    }
  }
  await navigate('graph');
}
const actions = {
  'show-in-tree': async () => { if (!selectedNode) return; const id = selectedNode; treeState.mode = 'structure'; treeState.focusId = null; treeState.query = ''; await navigate('tree'); await actions['tree-goto']({ id }); },
  'tree-select': ds => treeSelect(ds.id),
  'tree-toggle': ds => { if (treeState.expanded.has(ds.id)) treeState.expanded.delete(ds.id); else treeState.expanded.add(ds.id); paintTree(); },
  'tree-expand': () => { treeState.expanded = expandAll(treeState.data.roots); paintTree(); centerTreeOnRoot(); },
  'tree-collapse': () => { treeState.expanded = expandedToDepth(treeState.data.roots, 1); paintTree(); centerTreeOnRoot(); },
  'tree-unfocus': async () => { treeState.mode = 'structure'; treeState.focusId = null; await renderTree(); },
  'tree-trace-uses': () => treeTrace('uses'),
  'tree-trace-dependents': () => treeTrace('dependents'),
  'tree-goto': async ds => {
    const trail = pathTo(treeState.data.roots, ds.id);
    if (!trail) return toast('That item is not in this tree. Switch to Project structure to see it.', 'info');
    trail.forEach(x => treeState.expanded.add(x)); treeState.query = ''; const f = $('#treeFilter'); if (f) f.value = '';
    paintTree(); await treeSelect(ds.id);
  },
  'tree-reveal': async ds => { await window.graf.revealFile(ds.path); },
  'tree-copy-id': async ds => toast((await copyText(ds.id)) ? 'ID copied.' : 'Copy failed.', 'info'),
  'usage-scope': async ds => { usageScope = ds.scope; await renderUsage(); },
  'usage-clear': async () => { if (!await askConfirm({ title: 'Clear usage history?', message: 'This removes the recorded calls for this project. Your graph is not affected.', confirm: 'Clear', danger: true })) return; await window.graf.usage.clear(); toast('Usage history cleared.'); await renderUsage(); },
  'nav-integrations': () => navigate('integrations'),
  'open-project-row': async ds => { usageScope = 'project'; await openProject(ds.path); await navigate('usage'); },
  'modal-cancel': () => cancelActiveModal(),
  'retry-page': () => navigate(activePage),
  'nav-graph': () => navigate('tree'), 'nav-graph-explorer': () => navigate('graph'), 'nav-usage': () => navigate('usage'), 'nav-history': () => navigate('history'), 'nav-search': () => navigate('search'),
  'nav-impact': () => navigate('impact'), 'nav-context': () => navigate('context'), 'nav-integrations': () => navigate('integrations'), 'nav-projects': () => navigate('projects'),
  'add-project': () => pickAndAddProject(),
  'open-project': async ds => { closeProjectPopover(); if (ds.path === activeProject?.path && activePage !== 'projects') return navigate('overview'); await openProject(ds.path); },
  'reindex-project': async ds => { if (await askConfirm({ title: 'Rebuild this graph?', message: 'Graf will re-parse every source file. Notes and memories are preserved.', confirm: 'Rebuild' })) await openProject(ds.path, { fullSync: true }); },
  'rename-project': async ds => {
    const name = await askText({ title: 'Rename project', label: 'Display name', value: ds.name, confirm: 'Rename' });
    if (!name) return;
    await window.graf.projects.rename(ds.path, name);
    if (activeProject?.path === ds.path) { activeProject.name = name; applyProjectChrome(); }
    await refreshProjects(); await renderProjects(); toast('Project renamed.');
  },
  'remove-project': async ds => {
    if (!await askConfirm({ title: 'Remove project?', message: `“${ds.name}” will be removed from Graf. Your files and its .graf data are not deleted.`, detail: formatDisplayPath(ds.path), confirm: 'Remove', danger: true })) return;
    const wasActive = activeProject?.path === ds.path;
    await window.graf.projects.remove(ds.path);
    if (wasActive) { await showWelcome(); await navigate('projects'); } else { await refreshProjects(); await renderProjects(); }
    toast('Project removed from Graf.');
  },
  'repair-project': async ds => {
    const chosen = await window.graf.projects.choose(); if (!chosen) return;
    await window.graf.projects.add(chosen); await window.graf.projects.remove(ds.path);
    await openProject(chosen); toast('Project location updated.');
  },
  sync: () => syncProject(false),
  'rebuild-graph': async () => { if (await askConfirm({ title: 'Rebuild the graph?', message: 'Graf will re-parse every supported file. Human notes, memories and snapshots are preserved.', confirm: 'Rebuild' })) await syncProject(true); },
  'refresh-graph': () => navigate('graph'),
  'fit-graph': () => cy?.animate({ fit: { padding: 40 } }, { duration: 250 }),
  'graph-zoom-in': () => cy?.animate({ zoom: cy.zoom() * 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }, { duration: 150 }),
  'graph-zoom-out': () => cy?.animate({ zoom: cy.zoom() / 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }, { duration: 150 }),
  'inspect-node': ds => focusNode(ds.id),
  'inspect-memory': async ds => { memoryTab = 'all'; memoryQuery = ''; await navigate('memory'); requestAnimationFrame(() => { const el = document.getElementById(`memory-card-${ds.id}`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.classList.add('flash'); }); },
  'read-selected': async () => { if (!selectedNode) return; const node = await window.graf.graph.node(selectedNode); if (!node.path) throw new Error('This node has no source file.'); await navigate('explorer'); await openFile(node.path, Math.max(1, (Number(node.lineStart) || 1) - 3), Number(node.lineStart) || null); },
  'view-source': async ds => { selectedNode = ds.id; await actions['read-selected'](); },
  'impact-selected': async () => { if (!selectedNode) return; pendingImpact = selectedNode; await navigate('impact'); },
  'impact-pick': ds => showImpactFor(ds.id),
  'analyze-impact': () => runImpact(),
  'add-node-note': async () => { if (!selectedNode) return; const text = await askText({ title: 'Add node note', label: 'Human note', placeholder: 'Why this node matters', multiline: true, confirm: 'Add note' }); if (!text) return; await window.graf.notes.add({ text, nodeId: selectedNode }); toast('Note added.'); await showNodeInspector(selectedNode); },
  'edit-node-summary': async () => { if (!selectedNode) return; const node = await window.graf.graph.node(selectedNode); const summary = await askText({ title: 'Human summary', label: 'Summary (up to 500 characters)', placeholder: 'What should agents know about this node?', value: node.summary || '', multiline: true }); if (summary === null) return; await window.graf.graph.setSummary(selectedNode, summary); graphCache = null; toast('Summary saved.'); await showNodeInspector(selectedNode); },
  'toggle-node-pin': async (ds) => { if (!selectedNode) return; const pinned = ds.pinned === 'true'; await window.graf.graph.setPinned(selectedNode, !pinned, 10); toast(pinned ? 'Node unpinned.' : 'Node pinned for context.'); await showNodeInspector(selectedNode); },
  'toggle-node-hidden': async () => { if (!selectedNode) return; await window.graf.graph.setHidden(selectedNode, true); selectedNode = null; toast('Node hidden from the graph.'); await renderGraph(); },
  'add-node': async () => { const input = await askNodeForm(); if (!input) return; const node = await window.graf.graph.addNode(input); selectedNode = node.id; toast('Note node created.'); await renderGraph(); },
  'add-edge': async () => { const input = await askEdgeForm(); if (!input) return; await window.graf.graph.addEdge({ ...input, confidence: 1 }); toast('Relationship added.'); await renderGraph(); },
  'remove-edge': async ds => { if (!await askConfirm({ title: 'Remove relationship?', message: 'This removes only the human-created relationship. Source-derived relationships cannot be edited.', confirm: 'Remove', danger: true })) return; await window.graf.graph.removeEdge(ds.edge); toast('Relationship removed.'); await renderGraph(); },
  'copy-text': async ds => { const ok = await copyText(ds.text); toast(ok ? 'Copied to clipboard.' : 'Copy failed.', ok ? 'success' : 'error'); },
  'reveal-file': ds => window.graf.revealFile(ds.path),
  'open-project-folder': () => window.graf.openPath(activeProject.path),
  'open-folder': ds => window.graf.openPath(ds.path),
  'open-file': async ds => { await openFile(ds.id, ds.line ? Math.max(1, Number(ds.line) - 5) : 1, ds.line ? Number(ds.line) : null); },
  'source-prev': ds => openFile(ds.path, Number(ds.start)),
  'source-next': ds => openFile(ds.path, Number(ds.start)),
  'search-kind': ds => { searchKind = ds.kind; $$('#searchChips .chip').forEach(c => c.classList.toggle('active', c.dataset.kind === searchKind)); runSearch(); },
  'context-preset': ds => { $('#contextBudget').value = ds.n; },
  'build-context': async () => {
    const query = $('#contextQuery').value.trim(); if (!query) return toast('Describe the task or enter a query first.', 'error');
    const maxTokens = Math.max(200, Math.min(12000, Number($('#contextBudget').value) || 1200));
    const result = await window.graf.context.get({ query, maxTokens, includeDependencies: $('#contextDependencies').checked, includeMemory: $('#contextMemory').checked });
    lastContext = { ...result, query, maxTokens }; renderContextPreview();
  },
  'copy-context': async () => { if (!lastContext) return toast('Build context first.', 'error'); toast((await copyText(formatContext(lastContext, $('#contextFormat').value))) ? 'Context copied.' : 'Copy failed.'); },
  'save-context': async () => { if (!lastContext) return toast('Build context first.', 'error'); const format = $('#contextFormat').value; const r = await window.graf.context.save(format, formatContext(lastContext, format)); if (!r.canceled) toast(`Saved to ${r.exported}`); },
  'add-memory': async () => { const input = await askMemoryForm(); if (!input) return; await window.graf.memory.add(input); toast('Memory added.'); await updatePending(); if (activePage === 'memory') await renderMemory(); },
  'edit-memory': async ds => { const item = (await window.graf.memory.list()).find(m => m.id === ds.id); if (!item) throw new Error('Memory not found.'); const input = await askMemoryForm(item); if (!input) return; await window.graf.memory.update(ds.id, input); toast('Memory updated.'); await renderMemory(); },
  'approve-memory': async ds => { await window.graf.memory.approve(ds.id); toast('Memory approved.'); await updatePending(); await renderMemory(); },
  'archive-memory': async ds => { await window.graf.memory.archive(ds.id); toast('Memory archived.'); await renderMemory(); },
  'delete-memory': async ds => { if (!await askConfirm({ title: 'Delete memory?', message: 'This memory will be removed from Graf and no longer reach your agents.', confirm: 'Delete', danger: true })) return; await window.graf.memory.delete(ds.id); toast('Memory deleted.'); await updatePending(); await renderMemory(); },
  'memory-tab': ds => { memoryTab = ds.tab; return renderMemory(); },
  'proposal-tab': ds => { proposalTab = ds.tab; return renderProposals(); },
  'create-snapshot': async () => { const label = await askText({ title: 'Create snapshot', label: 'Label', placeholder: 'Before auth refactor', confirm: 'Create snapshot' }); if (label === null) return; await window.graf.history.snapshot(label || undefined); toast('Snapshot created.'); if (activePage === 'history') await renderHistory(); },
  'snapshot-diff': async ds => {
    const diff = await window.graf.history.diff(ds.id); const box = $('#historyDiff'); if (!box) return;
    const c = diff.counts || {};
    box.innerHTML = `<div class="panel"><div class="panel-head"><div class="panel-title">${icon('diff', 16)}Changes since ${escapeHtml(diff.from)} · v${diff.version}</div></div><div class="diagnostic-grid">${[['Added', c.added], ['Removed', c.removed], ['Modified', c.modified], ['Edges added', c.edgesAdded], ['Edges removed', c.edgesRemoved], ['Edges modified', c.edgesModified]].map(([k, v]) => `<div class="diagnostic-card"><small>${k}</small><strong>${number(v)}</strong></div>`).join('')}</div><div class="diff-list">${renderDiffDetails(diff)}</div></div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'snapshot-restore': async ds => { if (!await askConfirm({ title: 'Restore this snapshot?', message: 'Graf creates a safety snapshot first. Your source files are not changed.', confirm: 'Restore' })) return; await window.graf.history.restore(ds.id, { scope: 'all' }); graphCache = null; toast('Snapshot restored.'); await renderHistory(); await updateStatus(); },
  'approve-proposal': async ds => { if (!await askConfirm({ title: 'Apply this proposal?', message: 'Graf will apply the supported human-layer changes in this proposal.', confirm: 'Approve' })) return; await window.graf.proposals.approve(ds.id); graphCache = null; toast('Proposal approved.'); await updatePending(); await renderProposals(); },
  'reject-proposal': async ds => { await window.graf.proposals.reject(ds.id); toast('Proposal rejected.'); await updatePending(); await renderProposals(); },
  'commands-install': async () => {
    const r = await window.graf.integrations.commandsInstall({ rule: $('#cmdRule')?.checked });
    toast(`${r.written.length} file${r.written.length === 1 ? '' : 's'} written${r.skipped.length ? `, ${r.skipped.length} skipped because you already have files with those names` : ''}.`, r.skipped.length ? 'info' : 'success');
    await renderIntegrations();
  },
  'commands-remove': async () => {
    if (!await askConfirm({ title: 'Remove Graf commands?', message: 'Only files created by Graf are deleted. Anything you wrote yourself stays.', confirm: 'Remove', danger: true })) return;
    const r = await window.graf.integrations.commandsRemove(); toast(`${r.removed.length} file${r.removed.length === 1 ? '' : 's'} removed.`); await renderIntegrations();
  },
  'connect-mcp': async ds => connectClient(ds, false),
  'connect-anyway': async ds => { if (!await askConfirm({ title: `Connect ${ds.label} anyway?`, message: 'Graf could not find this application. It will still write the MCP entry, but it only takes effect if the application reads that file.', confirm: 'Connect anyway' })) return; await connectClient(ds, true); },
  'manual-mcp': async ds => showManualSetup(ds),
  'rescan-integrations': async () => { await renderIntegrations(); toast('Scan finished.', 'info'); },
  'nav-projects': () => navigate('projects'),
  'disconnect-mcp': async ds => { if (!await askConfirm({ title: `Disconnect ${ds.label}?`, message: 'Only Graf is removed. Other MCP servers in that configuration are preserved.', confirm: 'Disconnect', danger: true })) return; await window.graf.integrations.disconnect(ds.client); toast('Graf disconnected.'); await renderIntegrations(); },
  'test-runtime': async () => { const r = await window.graf.integrations.testRuntime(); toast(`Node runtime OK · ${r.version}`); },
  'test-mcp': async () => { const r = await window.graf.integrations.testMcp(); toast(`MCP handshake OK · ${r.toolCount} tools · ${r.protocolVersion}`); },
  'refresh-diagnostics': () => renderDiagnostics(),
  'backup-project': async () => { const r = await window.graf.project.backup(); if (!r.canceled) toast(`Backup created · ${r.backupPath}`); },
  'restore-backup': async () => { if (!await askConfirm({ title: 'Restore a backup?', message: 'You will choose a .graf-backup folder. A safety copy of the current graph is kept. Source files are not changed.', confirm: 'Choose backup…' })) return; const r = await window.graf.project.restoreBackup(); if (!r.canceled) { activeProject = r.project; graphCache = null; applyProjectChrome(); toast(`Backup restored. Safety copy: ${r.safetyBackup || 'not required'}`); await updateStatus(); await renderDiagnostics(); } },
  'export-json': async () => { const r = await window.graf.exportGraph('json', 'graf-export.json'); if (!r.canceled) toast(`Exported to ${r.exported}`); },
  'export-markdown': async () => { const r = await window.graf.exportGraph('markdown', 'graf-architecture.md'); if (!r.canceled) toast(`Exported to ${r.exported}`); },
  'edit-grafignore': async () => { const r = await window.graf.project.openGrafIgnore(); toast(`Opened ${r.path}`, 'info'); },
  'settings-tab': async ds => { settingsTab = ds.tab; await renderSettings(); }
};

/* ==========================================================================
   Event wiring
   ========================================================================== */
document.addEventListener('click', async event => {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) { if (!pageButton.disabled) navigate(pageButton.dataset.page); return; }
  if (event.target.closest('#projectSwitcher')) {
    const pop = $('#projectPopover'); const open = pop.classList.contains('hidden');
    if (open) { await refreshProjects(); }
    pop.classList.toggle('hidden', !open); $('#projectSwitcher').setAttribute('aria-expanded', String(open)); return;
  }
  if (!event.target.closest('#projectPopover')) closeProjectPopover();
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled || el.dataset.busy) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  el.dataset.busy = '1';
  try { await fn(el.dataset, el); }
  catch (error) { toast(error?.message || String(error), 'error'); setLoading(false); }
  finally { delete el.dataset.busy; }
});
$('#addProjectFromPopover').addEventListener('click', () => { closeProjectPopover(); pickAndAddProject().catch(e => toast(e.message, 'error')); });
$('#sidebarCollapse').addEventListener('click', () => toggleSidebar());
$('#searchTrigger').addEventListener('click', () => openPalette());
$('#quickSync').addEventListener('click', () => syncProject(false));
$('#aboutButton').addEventListener('click', () => { settingsTab = 'about'; navigate('settings'); });
document.addEventListener('change', async event => {
  if (event.target.id === 'contextFormat') return renderContextPreview();
  const setting = event.target.closest('[data-setting]'); if (!setting) return;
  try {
    const key = setting.dataset.setting;
    const result = await window.graf.preferences.set({ [key]: setting.checked });
    appPreferences = { ...appPreferences, ...result };
    if (key === 'startOnLogin') appPreferences.login = { ...(appPreferences.login || {}), openAtLogin: setting.checked };
    toast(key === 'closeToTray' ? (setting.checked ? 'Graf will stay in the system tray when closed.' : 'Close-to-tray disabled.') : (setting.checked ? 'Graf will start when you sign in.' : 'Startup launch disabled.'));
  } catch (error) { setting.checked = !setting.checked; toast(error.message, 'error'); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeProjectPopover();
  const mod = event.ctrlKey || event.metaKey; if (!mod) return;
  const key = event.key.toLowerCase();
  if (key === 'k' || (key === 'p' && event.shiftKey)) { event.preventDefault(); openPalette(); }
  else if (key === 'b') { event.preventDefault(); toggleSidebar(); }
  else if (key === 'g') { event.preventDefault(); navigate('tree'); }
  else if (['1', '2', '3', '4'].includes(key)) { event.preventDefault(); navigate(['overview', 'tree', 'usage', 'graph'][Number(key) - 1]); }
});
window.addEventListener('error', event => { if (/ResizeObserver/.test(event.message || '')) return; toast(event.message || 'Unexpected error', 'error'); });
window.addEventListener('unhandledrejection', event => { toast(event.reason?.message || 'Operation failed', 'error'); });
window.addEventListener('resize', () => { cy?.resize(); });

/* ==========================================================================
   Boot
   ========================================================================== */
async function boot() {
  mountStaticIcons(); renderNav(); setProjectNavigationEnabled(false); updateNav();
  if (store.get('sidebarCollapsed', false)) toggleSidebar(true);
  try {
    const [projects, active, prefs, info] = await Promise.all([
      window.graf.projects.list(),
      window.graf.projects.active(),
      window.graf.preferences.get().catch(() => appPreferences),
      window.graf.appInfo().catch(() => ({}))
    ]);
    if (info?.homedir) homeDirPath = info.homedir;
    appPreferences = prefs;
    await refreshProjects();
    if (active) { activeProject = active; applyProjectChrome(); applyStatus(await window.graf.project.status()); await updatePending(); await navigate('overview'); return; }
    const recent = [...projects].filter(p => p.exists !== false).sort((a, b) => String(b.lastOpenedAt || '').localeCompare(String(a.lastOpenedAt || '')))[0];
    if (recent?.lastOpenedAt) { await openProject(recent.path); return; }
  } catch (error) { toast(error.message, 'error'); }
  await showWelcome();
}
boot();
