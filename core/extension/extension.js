const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

function run(cli, cwd, args) {
  return new Promise((resolve, reject) => {
    const windowsShim = process.platform === 'win32' && !/\.(exe|com|js|mjs)$/i.test(cli);
    const command = windowsShim ? (process.env.ComSpec || 'cmd.exe') : cli;
    const commandArgs = windowsShim ? ['/d', '/s', '/c', `"${cli}" ${args.map(a => `"${String(a).replace(/"/g, '""')}"`).join(' ')}`] : args;
    cp.execFile(command, commandArgs, { cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else { try { resolve(JSON.parse(stdout)); } catch { resolve(stdout); } }
    });
  });
}
class GrafProvider {
  constructor(root, cli) { this.root = root; this.cli = cli; this.data = null; this.emitter = new vscode.EventEmitter(); this.onDidChangeTreeData = this.emitter.event; this.refresh(); }
  async refresh() { try { await run(this.cli, this.root, ['sync']); this.data = await run(this.cli, this.root, ['overview', '--depth', '1']); this.emitter.fire(); } catch (e) { vscode.window.showErrorMessage(`Graf: ${e.message}`); } }
  getTreeItem(item) { return item; }
  async getChildren(item) {
    if (!this.data) return [];
    if (!item) return [new vscode.TreeItem(`Project: ${this.data.project}`, vscode.TreeItemCollapsibleState.None), new vscode.TreeItem(`Files: ${this.data.fileCount} · Nodes: ${this.data.nodeCount}`, vscode.TreeItemCollapsibleState.None), new vscode.TreeItem('Modules', vscode.TreeItemCollapsibleState.Expanded), new vscode.TreeItem('Symbols', vscode.TreeItemCollapsibleState.Expanded)];
    if (item.label === 'Modules') return (this.data.modules || []).map(m => { const t = new vscode.TreeItem(m.path, vscode.TreeItemCollapsibleState.None); t.description = m.summary; t.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(path.join(this.root, m.path))] }; return t; });
    if (item.label === 'Symbols') return (this.data.symbols || []).map(n => { const t = new vscode.TreeItem(`${n.kind}: ${n.name}`, vscode.TreeItemCollapsibleState.None); t.description = n.path; t.tooltip = n.summary; t.contextValue = 'grafSymbol'; t.command = { command: 'graf.openSource', title: 'Open Source', arguments: [n] }; return t; });
    return [];
  }
}
function activate(context) {
  const folder = vscode.workspace.workspaceFolders?.[0]; if (!folder) return;
  const root = folder.uri.fsPath, cli = vscode.workspace.getConfiguration('graf').get('cliPath', 'graf');
  const provider = new GrafProvider(root, cli);
  const tree = vscode.window.createTreeView('grafExplorer', { treeDataProvider: provider });
  context.subscriptions.push(tree, provider.emitter);
  context.subscriptions.push(vscode.commands.registerCommand('graf.refresh', async () => { await provider.refresh(); vscode.window.showInformationMessage('Graf graph refreshed.'); }));
  context.subscriptions.push(vscode.commands.registerCommand('graf.openOverview', async () => { const data = await run(cli, root, ['overview', '--depth', '1']); const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(data, null, 2), language: 'json' }); vscode.window.showTextDocument(doc, { preview: true }); }));
  context.subscriptions.push(vscode.commands.registerCommand('graf.openGraph', async () => {
    const dbPath = path.join(root, '.graf', 'graph.json');
    if (!fs.existsSync(dbPath)) { vscode.window.showWarningMessage('Graf graph not found. Run Graf: Refresh Graph first.'); return; }
    const graph = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const nodes = Object.values(graph.nodes || {}).filter(n => !n.deletedAt && !n.hidden).slice(0, 180);
    const ids = new Set(nodes.map(n => n.id));
    const edges = Object.values(graph.edges || {}).filter(e => ids.has(e.src) && ids.has(e.dst)).slice(0, 350);
    const panel = vscode.window.createWebviewPanel('grafGraph', 'Graf: Project Graph', vscode.ViewColumn.Active, { enableScripts: true });
    const payload = JSON.stringify({ nodes, edges }).replace(/</g, '\\u003c');
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:13px system-ui;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);margin:0}header{padding:12px 16px;border-bottom:1px solid var(--vscode-panel-border)}svg{width:100vw;height:calc(100vh - 52px)}.edge{stroke:var(--vscode-editorWidget-border);stroke-width:1;opacity:.65}.node{cursor:pointer}.node circle{fill:var(--vscode-button-background);stroke:var(--vscode-button-border);stroke-width:1}.node text{fill:var(--vscode-editor-foreground);font-size:11px;pointer-events:none}.muted{opacity:.7}</style></head><body><header><b>Graf project graph</b> · ${nodes.length} nodes · ${edges.length} edges · Click a node to open source. Large graphs are limited to the first 180 active nodes.</header><svg id="graph" viewBox="0 0 1200 760" role="img" aria-label="Project graph"></svg><script>const data=${payload};const vscodeApi=acquireVsCodeApi();const svg=document.getElementById('graph'),ns='http://www.w3.org/2000/svg',W=1200,H=760,cx=W/2,cy=H/2;const pos=new Map();data.nodes.forEach((n,i)=>{const a=2*Math.PI*i/Math.max(1,data.nodes.length);const r=90+Math.sqrt(data.nodes.length)*17;pos.set(n.id,{x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r});});function el(tag,attrs,parent=svg){const e=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));parent.appendChild(e);return e;}data.edges.forEach(e=>{const a=pos.get(e.src),b=pos.get(e.dst);if(a&&b)el('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'edge'});});data.nodes.forEach(n=>{const p=pos.get(n.id),g=el('g',{class:'node',transform:'translate('+p.x+' '+p.y+')'});el('circle',{r:n.kind==='file'?13:9},g);const t=el('text',{x:16,y:4},g);t.textContent=(n.name||n.id).slice(0,30);g.addEventListener('click',()=>{vscodeApi.postMessage({command:'open',path:n.path,line:n.lineStart});});});</script></body></html>`;
    panel.webview.onDidReceiveMessage(message => { if (message.command === 'open' && message.path) { const target = path.resolve(root, message.path); if (!target.startsWith(root + path.sep)) return; const uri = vscode.Uri.file(target); vscode.workspace.openTextDocument(uri).then(doc => vscode.window.showTextDocument(doc).then(editor => { if (message.line) editor.revealRange(new vscode.Range(message.line - 1, 0, message.line - 1, 0)); })); } });
  }));
  context.subscriptions.push(vscode.commands.registerCommand('graf.addNote', async (node) => { if (!node) { vscode.window.showWarningMessage('Select a symbol in the Graf view first.'); return; } const text = await vscode.window.showInputBox({ prompt: `Note for ${node.name}` }); if (text) { await run(cli, root, ['note', text, '--node', node.id]); vscode.window.showInformationMessage('Graf note saved.'); } }));
  context.subscriptions.push(vscode.commands.registerCommand('graf.snapshot', async () => { const label = await vscode.window.showInputBox({ prompt: 'Snapshot label', value: 'manual' }); if (label) { await run(cli, root, ['snapshot', label]); vscode.window.showInformationMessage('Graf snapshot created.'); } }));
  context.subscriptions.push(vscode.commands.registerCommand('graf.showImpact', async node => { if (!node?.id) return; const impact = await run(cli, root, ['impact', node.id]); const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(impact, null, 2), language: 'json' }); await vscode.window.showTextDocument(doc, { preview: true }); }));
  context.subscriptions.push(vscode.commands.registerCommand('graf.pinNode', async node => { if (!node?.id) return; await run(cli, root, ['pin', node.id]); vscode.window.showInformationMessage(`Pinned ${node.name} in Graf overview.`); await provider.refresh(); }));
  context.subscriptions.push(vscode.commands.registerCommand('graf.openHistory', async () => { const history = await run(cli, root, ['history']); const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(history, null, 2), language: 'json' }); await vscode.window.showTextDocument(doc, { preview: true }); }));
  context.subscriptions.push(vscode.commands.registerCommand('graf.connectMcp', async () => { const target = await vscode.window.showQuickPick([{label:'VS Code workspace MCP',value:'vscode'},{label:'Cursor workspace MCP',value:'cursor'}], { placeHolder:'Choose MCP client configuration' }); if (!target) return; const folder = target.value === 'cursor' ? '.cursor' : '.vscode'; const file = path.join(root, folder, 'mcp.json'); let config = {}; try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} const isJavaScriptEntry = /\.m?js$/i.test(cli); const winShim = process.platform === 'win32' && !isJavaScriptEntry && !/\.(exe|com)$/i.test(cli); const entry = isJavaScriptEntry ? { command: process.execPath, args: [path.resolve(cli), 'serve', '--root', root] } : winShim ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${cli}" serve --root "${root}"`] } : { command: cli, args: ['serve', '--root', root] }; if (target.value === 'cursor') { config.mcpServers = { ...(config.mcpServers || {}), graf: entry }; } else { config.servers = { ...(config.servers || {}), graf: { type: 'stdio', ...entry } }; } fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n'); vscode.window.showInformationMessage(`Graf MCP configuration written to ${path.relative(root, file)}.`); }));
  context.subscriptions.push(vscode.commands.registerCommand('graf.openSource', async node => { if (!node?.path) return; const uri = vscode.Uri.file(path.join(root, node.path)); const doc = await vscode.workspace.openTextDocument(uri); const editor = await vscode.window.showTextDocument(doc); if (node.lineStart) editor.revealRange(new vscode.Range(node.lineStart - 1, 0, node.lineStart - 1, 0)); }));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20); status.command = 'graf.openOverview'; status.text = '$(graph) Graf: ready'; status.tooltip = 'Open Graf project overview'; status.show(); context.subscriptions.push(status);
  const refresh = () => provider.refresh();
  for (const pattern of ['**/*.{js,jsx,mjs,cjs,ts,tsx}','**/*.{py,java,cs,go,yaml,yml,toml}']) { const watcher = vscode.workspace.createFileSystemWatcher(pattern); watcher.onDidChange(refresh); watcher.onDidCreate(refresh); watcher.onDidDelete(refresh); context.subscriptions.push(watcher); }
  const originalRefresh = provider.refresh.bind(provider); provider.refresh = async () => { await originalRefresh(); if (provider.data) status.text = `$(graph) Graf: ${provider.data.nodeCount} nodes`; }; provider.refresh();
}
function deactivate() {}
module.exports = { activate, deactivate };
