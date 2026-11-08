import { launch } from './cdp.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scroll-')); const proj = path.join(tmp, 'p');
fs.mkdirSync(proj); for (const d of ['src', 'core/src']) fs.cpSync(path.join(appDir, d), path.join(proj, d), { recursive: true, filter: s => !/vendor|fonts/.test(s) });
const app = await launch({ appDir, userData: path.join(os.tmpdir(), 'graf-qa-scroll') });
await app.sleep(2000);
await app.eval(`window.graf.projects.add(${JSON.stringify(proj)})`); await app.eval(`window.graf.projects.open(${JSON.stringify(proj)}).then(()=>1)`);
await app.send('Page.reload'); await app.sleep(4000);
await app.setViewport(1280, 720);
for (const page of ['overview', 'tree', 'usage', 'projects', 'integrations', 'settings', 'graph']) {
  await app.eval(`(()=>{const b=document.querySelector('[data-page="${page}"]'); b.disabled=false; b.click();})()`); await app.sleep(1500);
  const m = await app.eval(`(()=>{const ws=document.querySelector('.workspace'); const cs=getComputedStyle(ws); const pc=document.querySelector('.page-content'); return {ws:{sh:ws.scrollHeight,ch:ws.clientHeight,ov:cs.overflowY,cls:ws.className}, pcH: pc?.scrollHeight, bodyOv:getComputedStyle(document.body).overflowY}})()`);
  await app.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: 600 }); await app.sleep(400);
  const after = await app.eval(`document.querySelector('.workspace').scrollTop`);
  console.log(page.padEnd(13), JSON.stringify(m), 'scrollTop after wheel =', after);
}
app.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0);
