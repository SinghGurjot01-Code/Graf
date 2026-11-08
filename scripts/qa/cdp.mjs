// Minimal CDP client + helpers for driving the real Graf Electron app.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const electronBinary = createRequire(import.meta.url)('electron'); // path to the Electron executable

export async function launch({ appDir, userData, port = 9400 + Math.floor(Math.random()*400), extra = [] }) {
  fs.rmSync(userData, { recursive: true, force: true });
  const flags = ['.', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-rasterization', '--disable-partial-raster', '--disable-gpu-compositing', `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, ...extra];
  // On Linux (CI / headless) run under a virtual display; Windows and macOS use the real one.
  const proc = process.platform === 'linux'
    ? spawn('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', electronBinary, ...flags], { cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(electronBinary, flags, { cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  proc.stdout.on('data', d => logs.push(String(d)));
  proc.stderr.on('data', d => logs.push(String(d)));
  let target;
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find(t => t.type === 'page' && t.url.includes('index.html'));
      if (target) break;
    } catch {}
  }
  if (!target) { proc.kill(); throw new Error('Electron did not start:\n' + logs.join('').slice(-3000)); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const consoleMsgs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) consoleMsgs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    else if (m.method === 'Runtime.exceptionThrown') consoleMsgs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const api = {
    send, sleep, consoleMsgs, logs,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(file) {
      await send('Page.bringToFront').catch(()=>{});
      const r = await Promise.race([send('Page.captureScreenshot', { format: 'png', fromSurface: true }), new Promise((_, rej) => setTimeout(() => rej(new Error('screenshot timeout')), 15000))]);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async click(sel) { return api.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'MISSING';e.click();return 'ok'})()`); },
    async setViewport(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
    close() { try { ws.close(); } catch {} proc.kill('SIGTERM'); }
  };
  return api;
}
