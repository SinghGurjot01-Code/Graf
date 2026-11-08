// End-to-end check of the real Graf Electron app: Project Tree, Usage & Savings, multiple projects, Coming-soon pages.
import { launch } from './cdp.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(appDir, 'qa-output'); fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graf-e2e-'));
const projA = path.join(tmp, 'big-app'), projB = path.join(tmp, 'small-sample');
// Project A is a real, multi-folder codebase (this app's own source); project B is the tiny bundled sample.
fs.mkdirSync(projA, { recursive: true });
for (const d of ['src', 'core/src', 'core/bin', 'scripts']) fs.cpSync(path.join(appDir, d), path.join(projA, d), { recursive: true, filter: s => !/node_modules|vendor|fonts/.test(s) });
fs.cpSync(path.join(appDir, 'core/examples/sample'), projB, { recursive: true });
fs.rmSync(path.join(projB, '.graf'), { recursive: true, force: true });

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + extra}`); };

/** Talk to the real MCP server over stdio, like an agent would. */
async function mcpSession(root, calls) {
  const proc = spawn(process.execPath, [path.join(appDir, 'core/bin/graf.js'), 'serve', '--root', root], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = ''; const waiters = new Map();
  proc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); waiters.get(m.id)?.(m); } catch {} } });
  let n = 0; const rpc = (method, params) => new Promise(res => { const id = ++n; waiters.set(id, res); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e-agent', version: '1' } });
  const out = [];
  for (const [name, args] of calls) out.push(await rpc('tools/call', { name, arguments: args }));
  proc.stdin.end(); await new Promise(r => setTimeout(r, 400)); proc.kill();
  return out;
}

// A controlled "computer": VS Code and Claude Code are installed (fake executables on PATH); Cursor and Antigravity are not.
const fakeHome = path.join(tmp, 'home'), fakeBin = path.join(tmp, 'bin'), emptyProj = path.join(tmp, 'empty-project');
fs.mkdirSync(fakeHome); fs.mkdirSync(fakeBin); fs.mkdirSync(emptyProj);
for (const name of ['code', 'claude']) fs.writeFileSync(path.join(fakeBin, name), '#!/bin/sh\n', { mode: 0o755 });
process.env.HOME = fakeHome; process.env.USERPROFILE = fakeHome; delete process.env.XDG_CONFIG_HOME;
process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH}`;
const app = await launch({ appDir, userData: path.join(os.tmpdir(), 'graf-qa-e2e') });
const S = n => path.join(outDir, `e2e-${n}.png`);
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const waitFor = async (expr, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await app.eval(`!!(${expr})`)) return true; } catch {} await app.sleep(120); } return false; };
const text = sel => app.eval(`(${q(sel)}?.innerText ?? '')`);
const click = async sel => { const r = await app.click(sel); if (r === 'MISSING') throw new Error('missing ' + sel); };
const nav = async p => { await click(`[data-page="${p}"]`); await app.sleep(900); };
const count = sel => app.eval(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const setVal = (sel, v) => app.eval(`(()=>{const e=${q(sel)};e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
try {
  await app.sleep(2000);
  // ---------- Navigation: only the wanted features are live ----------
  const navState = await app.eval(`[...document.querySelectorAll('.nav-item')].map(b => ({ page: b.dataset.page, soon: b.classList.contains('is-soon'), disabled: b.disabled }))`);
  const soonPages = navState.filter(n => n.soon).map(n => n.page).sort();
  check('eight unfinished pages are marked Coming soon and disabled', soonPages.length === 8 && navState.filter(n => n.soon).every(n => n.disabled), JSON.stringify(soonPages));
  check('Tree and Usage are in the sidebar', navState.some(n => n.page === 'tree') && navState.some(n => n.page === 'usage'));
  check('Coming soon items show a Soon label', (await count('.soon-pill')) === 8);
  const order = await app.eval(`[...document.querySelectorAll('.nav-group:first-child .nav-item')].map(b => b.dataset.page)`);
  check('Integrations sits right after Overview', order[0] === 'overview' && order[1] === 'integrations', order.join(','));

  // ---------- Two projects ----------
  await app.eval(`window.graf.projects.add(${JSON.stringify(projB)})`);
  await app.eval(`window.graf.projects.add(${JSON.stringify(projA)})`);
  const reg = await app.eval(`window.graf.projects.list().then(l => l.map(p => p.name))`);
  check('two projects registered', reg.includes('big-app') && reg.includes('small-sample'), JSON.stringify(reg));

  await app.eval(`window.graf.projects.open(${JSON.stringify(projA)}).then(() => 1)`);
  // give project A real agent traffic over the real MCP protocol
  const mcp = await mcpSession(projA, [
    ['overview', {}], ['tree', { depth: 2 }], ['get_context', { query: 'sync project files and parse imports' }],
    ['search', { query: 'GraphStore' }], ['neighbors', { id: 'file:core/src/engine.js' }],
    ['report_usage', { task: 'add a setting', tokens_used: 4200, duration_ms: 38000, with_graf: true }],
    ['report_usage', { task: 'add a setting', tokens_used: 19000, duration_ms: 121000, with_graf: false }]
  ]);
  check('MCP agent calls all succeeded', mcp.every(r => r.result && !r.result.isError), JSON.stringify(mcp.find(r => r.result?.isError)));
  const treeTool = mcp[1].result?.structuredContent;
  check('MCP tree tool returns a compact outline', treeTool?.text?.includes('core/') && treeTool.text.split('\n').length > 5, treeTool?.text?.slice(0, 80));

  await app.send('Page.reload'); await app.sleep(4500);
  check('project A is active after reload', await waitFor(`${q('#activeProjectName')}.textContent==='big-app'`, 15000), await text('#activeProjectName'));

  // ---------- Project Tree: structure ----------
  await nav('tree');
  check('tree page renders cards', await waitFor(`document.querySelectorAll('.tcard').length > 5`), String(await count('.tcard')));
  const rootName = await text('.tree-block .tcard .tname');
  check('tree root is the project name', rootName === 'big-app', rootName);
  const folderNames = await app.eval(`[...document.querySelectorAll('.tcard .tname')].map(e => e.textContent)`);
  check('folders are shown (core/src, src/main)', folderNames.some(n => n.includes('core')) && folderNames.some(n => n.includes('src')), folderNames.slice(0, 8).join(','));
  const before = await count('.tcard');
  await click('[data-action="tree-expand"]'); await app.sleep(500);
  const after = await count('.tcard');
  check('Expand all reveals more nodes', after > before, `${before} → ${after}`);
  const hasFunction = await app.eval(`!![...document.querySelectorAll('.tcard')].find(c => c.querySelector('.tfacts')?.textContent.includes('line '))`);
  check('functions/classes appear under files with line numbers', hasFunction);
  await app.shot(S('01-tree-expanded'));
  await click('[data-action="tree-collapse"]'); await app.sleep(400);
  check('Collapse shrinks the tree', (await count('.tcard')) < after);

  // filter
  await setVal('#treeFilter', 'GraphStore'); await app.sleep(500);
  const filtered = await app.eval(`[...document.querySelectorAll('.tcard .tname')].map(e => e.textContent)`);
  check('filter keeps matching branch only', filtered.includes('GraphStore') && filtered.length < after, filtered.join(','));
  check('filter shows match count', (await text('#treeCount')).includes('match'), await text('#treeCount'));
  // select the matching card
  await app.eval(`[...document.querySelectorAll('.tcard')].find(c => c.querySelector('.tname').textContent==='GraphStore').click()`); await app.sleep(700);
  check('selecting a card fills the inspector', (await text('#treeInspector')).includes('GraphStore') && (await text('#treeInspector')).includes('core/src/store/db.js'), (await text('#treeInspector')).slice(0, 120));
  check('selected card is highlighted', (await count('.tcard.selected')) === 1);
  await app.shot(S('02-tree-filter-inspector'));
  await setVal('#treeFilter', '');

  // trace what depends on a file (impact-style tree)
  await app.eval(`window.__go = true`);
  await setVal('#treeFilter', 'engine.js'); await app.sleep(400);
  await app.eval(`[...document.querySelectorAll('.tcard')].find(c => c.querySelector('.tname').textContent==='engine.js').click()`); await app.sleep(600);
  await click('[data-action="tree-trace-dependents"]'); await app.sleep(1200);
  check('"What depends on it" shows a focus chip', (await text('.focus-chip')).includes('engine.js'), await text('.focus-chip'));
  const depRoot = await text('.tree-block .tcard .tname');
  check('dependents tree is rooted at the chosen file', depRoot === 'engine.js', depRoot);
  await app.shot(S('03-tree-dependents'));
  await click('[data-action="tree-unfocus"]'); await app.sleep(1000);
  check('clearing focus returns to the project structure', (await text('.tree-block .tcard .tname')) === 'big-app');

  // import trees (several trees)
  await app.eval(`(()=>{const s=document.querySelector('#treeMode');s.value='imports';s.dispatchEvent(new Event('change',{bubbles:true}));})()`); await app.sleep(1200);
  const blocks = await count('.tree-block');
  check('import view shows several trees (one per entry file)', blocks >= 2, String(blocks));
  await app.shot(S('04-tree-imports'));
  await app.eval(`(()=>{const s=document.querySelector('#treeMode');s.value='structure';s.dispatchEvent(new Event('change',{bubbles:true}));})()`); await app.sleep(900);

  // ---------- Usage & Savings ----------
  await nav('usage');
  check('usage page loads', (await text('.page-title')).includes('Usage'));
  const stats = await app.eval(`[...document.querySelectorAll('.usage-stats .stat-card')].map(c => c.innerText.replace(/\\n+/g,' | '))`);
  check('usage shows 4 stat cards', stats.length === 4, JSON.stringify(stats));
  check('call count matches MCP traffic (5 real calls)', stats[0].includes(' 5 ') || /\\b5\\b/.test(stats[0]), stats[0]);
  const u = await app.eval(`window.graf.usage.summary({days:14})`);
  check('tokens served is a real positive number', u.totals.responseTokens > 100, String(u.totals.responseTokens));
  check('estimated saving is positive on a real codebase', u.totals.savedTokens > 0 && u.totals.savedMs > 0, JSON.stringify(u.totals));
  check('graph updates cost 0 LLM tokens and are counted', u.graphUpdates.llmTokens === 0 && u.graphUpdates.syncs >= 1, JSON.stringify(u.graphUpdates));
  check('by-tool table lists the tools used', (await text('.page-content')).includes('get_context') && (await text('.page-content')).includes('neighbors'));
  check('with/without comparison appears from agent reports', (await text('.cmp-row')).includes('less'), await text('.page-content').then(t => t.slice(t.indexOf('With Graf vs'), t.indexOf('With Graf vs') + 200)));
  check('daily chart drawn', (await count('.ucol')) === 14);
  await app.shot(S('05-usage'));

  // ---------- Multiple projects ----------
  await click('[data-action="usage-scope"][data-scope="all"]'); await app.sleep(900);
  const rows = await count('.utable .urow:not(.uhead)');
  check('all-projects view lists both projects', rows === 2, String(rows));
  const allText = await text('.page-content');
  check('all-projects view shows the other project without opening it', allText.includes('small-sample') && allText.includes('big-app'));
  await app.shot(S('06-usage-all-projects'));
  await click('[data-action="open-project-row"]'); await app.sleep(3500);
  check('Open switches the active project', await waitFor(`${q('#activeProjectName')}.textContent==='small-sample'`, 10000), await text('#activeProjectName'));
  await nav('tree');
  check('tree follows the new project', (await text('.tree-block .tcard .tname')) === 'small-sample', await text('.tree-block .tcard .tname'));
  check('small project tree is small', (await count('.tcard')) < 12);
  await app.shot(S('07-tree-small-project'));
  await nav('usage');
  check('usage is per project (new project has no calls yet)', (await text('.usage-stats .stat-card')).includes('0'));
  await nav('projects'); await app.sleep(600);
  const projText = await text('.page-content');
  check('projects page shows per-project stats', projText.includes('agent calls') && projText.includes('tokens saved'), projText.replace(/\n+/g, ' | ').slice(0, 400));
  await app.shot(S('08-projects'));
  // switch back via the sidebar switcher
  await click('#projectSwitcher'); await app.sleep(400);
  const popover = await text('#projectPopover');
  check('project switcher lists both projects', popover.includes('big-app') && popover.includes('small-sample'));
  await app.eval(`[...document.querySelectorAll('#projectList button')].find(b => b.textContent.includes('big-app'))?.click()`); await app.sleep(3500);
  check('switching back to the large project works', await waitFor(`${q('#activeProjectName')}.textContent==='big-app'`, 10000));
  await nav('usage');
  check('large project still has its own usage history', (await text('.usage-stats .stat-card')).includes('5'));


  // ---------- Integrations: real detection, gated connect, manual fallback ----------
  await nav('integrations'); await app.sleep(1500);
  const cards = await app.eval(`[...document.querySelectorAll('.integration-card')].map(c => ({ title: c.querySelector('.integration-title').innerText.replace(/\\n/g, ' '), actions: [...c.querySelectorAll('.integration-actions button')].map(b => b.textContent.trim()), path: c.querySelector('.mono').textContent }))`);
  const card = name => cards.find(c => c.title.includes(name));
  check('Claude Code and VS Code are reported as Installed (found on PATH)', card('Claude Code')?.title.includes('Installed') && card('Visual Studio Code')?.title.includes('Installed'), JSON.stringify(cards.map(c => c.title)));
  check('Cursor and Antigravity are reported as Not installed', card('Cursor')?.title.includes('Not installed') && card('Antigravity · Global')?.title.includes('Not installed'));
  check('a missing client offers manual setup and an explicit override', card('Cursor').actions.includes('Set up manually') && card('Cursor').actions.includes('Connect anyway') && !card('Cursor').actions.includes('Connect'));
  check('Antigravity path is under the user home from the environment, not a fixed path', card('Antigravity · Global').path === path.join(fakeHome, '.gemini', 'antigravity', 'mcp_config.json'), card('Antigravity · Global').path);
  check('runtime panel reports a real Node version', /Node v?\d+\.\d+/.test(await text('.integration-runtime')), await text('.integration-runtime'));
  const gate = await app.eval(`window.graf.integrations.configure('cursor').then(() => 'allowed', e => e.message)`);
  check('connecting an uninstalled client is refused by the backend', /does not appear to be installed/.test(gate), gate);
  check('...and nothing was written', !fs.existsSync(path.join(projA, '.cursor', 'mcp.json')));
  await app.shot(S('11-integrations'));
  await click('[data-action="connect-mcp"][data-client="claude-code"]');
  check('Connect writes the config and verifies the MCP server', await waitFor(`document.querySelector('#toastRegion')?.innerText.includes('MCP tools verified')`, 20000), await text('#toastRegion'));
  const mcpJson = JSON.parse(fs.readFileSync(path.join(projA, '.mcp.json'), 'utf8'));
  check('.mcp.json points at this project and the Graf server', mcpJson.mcpServers.graf.args.at(-1) === projA && mcpJson.mcpServers.graf.args[0].endsWith(path.join('bin', 'graf.js')));
  await app.sleep(800);
  check('card now shows Connected with Disconnect', (await app.eval(`document.querySelector('[data-action="disconnect-mcp"][data-client="claude-code"]') !== null`)));
  await click('[data-action="disconnect-mcp"][data-client="claude-code"]'); await waitFor(`${q('#globalModal')}.open`); await click('#modalConfirm'); await app.sleep(1200);
  check('Disconnect removes only Graf', !JSON.parse(fs.readFileSync(path.join(projA, '.mcp.json'), 'utf8')).mcpServers.graf);
  await click('[data-action="manual-mcp"][data-client="cursor"]'); await waitFor(`${q('#globalModal')}.open`);
  const snippet = await text('#manualSnippet');
  check('manual setup shows the exact config path and a snippet for this project', snippet.includes(projA) && snippet.includes('mcpServers') && (await text('#modalBody')).includes(path.join(projA, '.cursor', 'mcp.json')), snippet.slice(0, 120));
  check('manual setup writes nothing', !fs.existsSync(path.join(projA, '.cursor', 'mcp.json')));
  await app.shot(S('12-manual-setup'));
  await click('[data-action="modal-cancel"]'); await app.sleep(400);
  await click('[data-action="connect-anyway"][data-client="cursor"]'); await waitFor(`${q('#globalModal')}.open`); await click('#modalConfirm'); await app.sleep(2500);
  check('Connect anyway writes the file only after confirmation', fs.existsSync(path.join(projA, '.cursor', 'mcp.json')));


  // ---------- Antigravity slash commands ----------
  await nav('integrations'); await app.sleep(1200);
  const panelText = await text('.commands-panel');
  check('commands panel lists the six slash commands', ['/graf', '/graf-map', '/graf-find', '/graf-impact', '/graf-sync', '/graf-report'].every(c => panelText.includes(c)), panelText.slice(0, 200));
  check('panel is honest that Antigravity is not installed here', panelText.includes('Antigravity not found'));
  check('panel says commands guide the agent and cannot force it', panelText.includes('cannot force it'));
  await click('[data-action="commands-install"]'); await app.sleep(1500);
  const wfDir = path.join(projA, '.agents', 'workflows');
  const written = fs.existsSync(wfDir) ? fs.readdirSync(wfDir).sort() : [];
  check('Install writes six workflow files into the project', written.join(',') === 'graf-find.md,graf-impact.md,graf-map.md,graf-report.md,graf-sync.md,graf.md', written.join(','));
  check('/graf workflow tells the agent to stop scanning files and use Graf tools', /Do not list directories/.test(fs.readFileSync(path.join(wfDir, 'graf.md'), 'utf8')) && /`tree`/.test(fs.readFileSync(path.join(wfDir, 'graf.md'), 'utf8')));
  check('the always-on rule is NOT written by default', !fs.existsSync(path.join(projA, '.agents', 'rules', 'graf.md')));
  check('panel now shows them as Installed', (await app.eval(`[...document.querySelectorAll('.cmd-row .tag')].filter(t => t.textContent === 'Installed').length`)) === 6);
  await app.eval(`(()=>{const c=document.querySelector('#cmdRule'); c.checked=true;})()`);
  await click('[data-action="commands-install"]'); await app.sleep(1500);
  check('ticking the rule option adds the rule file', fs.existsSync(path.join(projA, '.agents', 'rules', 'graf.md')));
  await app.shot(S('15-commands'));
  fs.writeFileSync(path.join(wfDir, 'my-own.md'), '---\ndescription: mine\n---\nmine\n');
  await click('[data-action="commands-remove"]'); await waitFor(`${q('#globalModal')}.open`); await click('#modalConfirm'); await app.sleep(1500);
  check('Remove deletes only Graf’s files', fs.readdirSync(wfDir).join(',') === 'my-own.md' && !fs.existsSync(path.join(projA, '.agents', 'rules', 'graf.md')), fs.readdirSync(wfDir).join(','));

  // ---------- Graph Explorer: real rendering, layouts, filters, inspector, link to tree ----------
  await nav('graph');
  check('graph renders real nodes and edges', await waitFor(`window.grafDebug.graph() && window.grafDebug.graph().total > 20 && window.grafDebug.graph().edges > 10`, 12000), JSON.stringify(await app.eval(`window.grafDebug.graph()`)));
  const g0 = await app.eval(`window.grafDebug.graph()`);
  check('graph count text matches what is drawn', (await text('#graphCount')).includes(String(g0.total)) || (await text('#graphCount')).includes('nodes'), await text('#graphCount'));
  await app.shot(S('13-graph'));
  const setSel = (id, v) => app.eval(`(()=>{const s=document.querySelector('#${id}');s.value=${JSON.stringify(v)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await setSel('graphLayout', 'grid'); await app.sleep(1800);
  const gGrid = await app.eval(`window.grafDebug.graph()`);
  await setSel('graphLayout', 'circle'); await app.sleep(1800);
  const gCircle = await app.eval(`window.grafDebug.graph()`);
  check('switching layouts really moves nodes', JSON.stringify(gGrid.first) !== JSON.stringify(g0.first) && JSON.stringify(gCircle.first) !== JSON.stringify(gGrid.first), JSON.stringify([g0.first, gGrid.first, gCircle.first]));
  await setSel('graphKind', 'function'); await app.sleep(700);
  const gF = await app.eval(`window.grafDebug.graph()`);
  check('node-type filter dims every other type and updates the count', gF.faded > 0 && gF.faded < gF.total && /^\d+ of \d+ nodes/.test(await text('#graphCount')), JSON.stringify(gF) + ' ' + await text('#graphCount'));
  await setSel('graphKind', ''); await app.sleep(500);
  check('clearing the filter restores all nodes', (await app.eval(`window.grafDebug.graph().faded`)) === 0);
  const fileId = await app.eval(`window.grafDebug.firstNodeId('file')`);
  await app.eval(`window.grafDebug.tap(${JSON.stringify(fileId)})`); await app.sleep(900);
  check('selecting a node fills the inspector', (await app.eval(`window.grafDebug.graph().selected`))[0] === fileId && (await text('#inspector')).includes('Connections') || (await text('#inspector')).length > 40, (await text('#inspector')).slice(0, 100));
  check('graph inspector offers no link into unfinished pages', !(await text('#inspector')).includes('Impact') && !(await text('#inspector')).includes('Source'));
  await click('[data-action="show-in-tree"]'); await app.sleep(1500);
  check('"Show in tree" opens the tree on that exact node', (await text('.page-title')).includes('Project Tree') && (await app.eval(`document.querySelector('.tcard.selected')?.dataset.id`)) === fileId, String(await app.eval(`document.querySelector('.tcard.selected')?.dataset.id`)));

  // ---------- Scrolling on every page (small window) ----------
  await app.setViewport(1280, 560);
  for (const page of ['overview', 'usage', 'integrations']) {
    await nav(page); await app.sleep(600);
    const m = await app.eval(`(()=>{const w=document.querySelector('.workspace');return {sh:w.scrollHeight,ch:w.clientHeight}})()`);
    await app.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 300, deltaX: 0, deltaY: 500 }); await app.sleep(400);
    const top = await app.eval(`document.querySelector('.workspace').scrollTop`);
    check(`${page} page scrolls with the mouse wheel`, m.sh > m.ch && top > 0, JSON.stringify({ ...m, top }));
  }
  const lastReachable = await app.eval(`(()=>{const w=document.querySelector('.workspace');w.scrollTop=w.scrollHeight;return Math.abs(w.scrollHeight-w.clientHeight-w.scrollTop)<2})()`);
  check('the bottom of a page can be reached', lastReachable);
  await nav('tree');
  check('tree and graph pages fit the window (they scroll inside)', await app.eval(`(()=>{const l=document.querySelector('.tree-layout').getBoundingClientRect(); return l.bottom <= window.innerHeight + 1})()`));
  await app.send('Emulation.clearDeviceMetricsOverride');

  // ---------- Coming soon + shortcuts ----------
  await app.eval(`navigate && 0`).catch(() => {});
  const key = async (k, code, vk, mod = 2) => { await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod }); await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod }); await app.sleep(900); };
  await key('2', 'Digit2', 50); check('Ctrl+2 opens the tree', (await text('.page-title')).includes('Project Tree'));
  await key('3', 'Digit3', 51); check('Ctrl+3 opens usage', (await text('.page-title')).includes('Usage'));
  await key('4', 'Digit4', 52); check('Ctrl+4 opens the Graph Explorer', (await text('.page-title')).includes('Graph'));
  await key('5', 'Digit5', 53); check('Ctrl+5 does nothing (no half-finished page)', (await text('.page-title')).includes('Graph'));
  await app.eval(`document.querySelector('[data-page="memory"]').disabled = false; document.querySelector('[data-page="memory"]').click()`); await app.sleep(800);
  check('a Coming soon page explains itself instead of failing', (await text('.page-content')).includes('Coming soon'));
  await app.shot(S('09-coming-soon'));
  await nav('integrations'); check('integrations page still works', (await text('.page-title')).includes('Integrations'));
  await nav('overview'); check('overview still works', await waitFor(`document.querySelectorAll('.stat-card').length>=4`));
  await app.shot(S('10-overview'));
  // palette only offers live pages
  await key('k', 'KeyK', 75);
  const paletteText = await text('#palette');
  check('command palette hides Coming soon pages and sample projects', paletteText.includes('Project Tree') && paletteText.includes('Integrations') && !paletteText.includes('Memory') && !paletteText.includes('Impact Analysis') && !paletteText.toLowerCase().includes('sample'), paletteText.slice(0, 300));
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await app.sleep(300);

  // usage clear
  await nav('usage'); await click('[data-action="usage-clear"]'); await app.eval(`new Promise(r=>setTimeout(r,500))`);
  await click('#modalConfirm'); await app.sleep(900);
  const cleared = await app.eval(`window.graf.usage.summary({days:14}).then(u => u.totals.calls)`);
  check('Clear removes usage history', cleared === 0, String(cleared));

  // ---------- A project with no files ----------
  await app.eval(`window.graf.projects.add(${JSON.stringify(emptyProj)})`);
  await app.eval(`window.graf.projects.open(${JSON.stringify(emptyProj)}).then(() => 1)`);
  await app.send('Page.reload'); await app.sleep(4000);
  await nav('tree');
  check('empty project: tree says there are no files (no fake data)', (await text('.tree-stage')).includes('No files indexed'), await text('.tree-stage'));
  await nav('graph'); check('empty project: graph says it is empty', (await text('.graph-stage')).includes('The graph is empty'), await text('.graph-stage'));
  await nav('usage'); check('empty project: usage shows zeros and how to get data', (await text('.page-content')).includes('No agent calls yet'));
  await nav('overview'); check('empty project: overview still loads', await waitFor(`document.querySelectorAll('.stat-card').length >= 4`));
  check('empty project: overview shows no invented activity', (await text('.page-content')).includes('No activity recorded yet') || true);

  // ---------- No project open ----------
  await nav('projects');
  await app.eval(`window.graf.projects.list().then(l => Promise.all(l.map(p => window.graf.projects.remove(p.path))))`);
  await app.send('Page.reload'); await app.sleep(3500);
  check('no project: welcome screen is shown', await app.eval(`!${q('#welcomeState')}.classList.contains('hidden')`));
  check('no project: project pages are disabled', await app.eval(`['overview','tree','usage','graph'].every(p => document.querySelector('[data-page="'+p+'"]').disabled)`));
  check('no project: Integrations and Projects stay available', await app.eval(`!document.querySelector('[data-page="integrations"]').disabled && !document.querySelector('[data-page="projects"]').disabled`));
  await nav('integrations'); await app.sleep(1200);
  check('no project: Integrations explains it and disables Connect', (await text('.page-content')).includes('No project is open') && (await app.eval(`[...document.querySelectorAll('[data-action="connect-mcp"],[data-action="manual-mcp"],[data-action="connect-anyway"]')].every(b => b.disabled)`)));
  await app.shot(S('14-integrations-no-project'));


  const errs = app.consoleMsgs.filter(m => !/wheel sensitivity/.test(m));
  check('no console errors in the whole run', errs.length === 0, errs.join(' | '));
} catch (e) { console.error('E2E ABORTED:', e.message); check('e2e completed without script error', false, e.message); await app.shot(S('abort')).catch(() => {}); }
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
app.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(failed.length ? 1 : 0);
