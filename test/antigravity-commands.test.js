import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AntigravityCommands, COMMANDS, RULE, MARKER, MAX_FILE_CHARS } from '../src/main/antigravity-commands.js';
import { GrafEngine } from '../core/src/engine.js';
import { McpServer } from '../core/src/mcp/server.js';

const tmp = async t => { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'graf-cmds-')); t.after(() => fs.rm(d, { recursive: true, force: true })); return d; };

test('every command is a valid Antigravity workflow: frontmatter description, marker, under the size limit', () => {
  assert.deepEqual(COMMANDS.map(c => c.name), ['graf', 'graf-map', 'graf-find', 'graf-impact', 'graf-sync', 'graf-report']);
  for (const item of [...COMMANDS, RULE]) {
    assert.ok(item.text.includes(MARKER), `${item.name} carries the Graf marker`);
    assert.ok(item.text.length < MAX_FILE_CHARS, `${item.name} fits the 12,000 character limit`);
  }
  for (const c of COMMANDS) assert.match(c.text, /^---\ndescription: .+\n---\n/, `${c.name} starts with a description`);
  assert.match(COMMANDS[0].text, /Do not list directories, grep, search or open files/);
});

test('commands only mention Graf tools that really exist in the MCP server', async t => {
  const root = await tmp(t); await fs.writeFile(path.join(root, 'a.js'), 'export const a = 1;\n');
  const engine = new GrafEngine(root); await engine.init();
  try {
    const mcp = new McpServer(engine);
    const real = new Set((await mcp.dispatch({ id: 1, method: 'tools/list', params: {} })).result.tools.map(x => x.name));
    for (const item of [...COMMANDS, RULE]) {
      const mentioned = [...item.text.matchAll(/`([a-z_]+)`/g)].map(m => m[1]).filter(n => /^(tree|overview|search|get_node|neighbors|impact_of|read_node|get_context|memory_\w+|propose_changes|changes_since|report_usage|sync_status)$/.test(n));
      assert.ok(mentioned.length > 0, `${item.name} calls at least one Graf tool`);
      for (const name of mentioned) assert.ok(real.has(name), `${item.name} mentions ${name}, which must exist`);
    }
    // every backticked snake_case word that looks like a tool must be real (catches typos like get_contxt)
    for (const item of [...COMMANDS, RULE]) for (const m of item.text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) if (!['include_dependencies', 'tokens_used', 'duration_ms', 'with_graf'].includes(m[1])) assert.ok(real.has(m[1]), `unknown tool ${m[1]} in ${item.name}`);
    // arguments used in the commands exist in the tool schemas
    const schema = name => mcp.dispatch({ id: 2, method: 'tools/list', params: {} }).then(r => r.result.tools.find(x => x.name === name).inputSchema.properties);
    assert.ok('include_dependencies' in await schema('get_context'));
    for (const k of ['task', 'tokens_used', 'duration_ms', 'with_graf']) assert.ok(k in await schema('report_usage'));
  } finally { engine.close(); }
});

test('install writes the workflows into .agents/workflows and is idempotent', async t => {
  const root = await tmp(t); const ag = new AntigravityCommands();
  const first = await ag.install(root);
  assert.equal(first.written.length, 6);
  const file = path.join(root, '.agents', 'workflows', 'graf.md');
  assert.equal(await fs.readFile(file, 'utf8'), COMMANDS[0].text);
  await assert.rejects(fs.access(path.join(root, '.agents', 'rules', 'graf.md')), 'the rule is opt-in');
  const second = await ag.install(root);
  assert.equal(second.written.length, 0, 'nothing rewritten when already current');
  const status = await ag.status(root);
  assert.ok(status.items.filter(i => i.kind === 'workflow').every(i => i.state === 'installed'));
  assert.equal(status.items.find(i => i.kind === 'rule').state, 'missing');
});

test('the always-on rule is written only when asked', async t => {
  const root = await tmp(t); const ag = new AntigravityCommands();
  await ag.install(root, { rule: true });
  assert.equal(await fs.readFile(path.join(root, '.agents', 'rules', 'graf.md'), 'utf8'), RULE.text);
});

test('a legacy .agent folder is respected instead of creating a second one', async t => {
  const root = await tmp(t); await fs.mkdir(path.join(root, '.agent'));
  await new AntigravityCommands().install(root);
  await fs.access(path.join(root, '.agent', 'workflows', 'graf.md'));
  await assert.rejects(fs.access(path.join(root, '.agents')));
});

test('a user’s own workflow with the same name is never overwritten or removed', async t => {
  const root = await tmp(t); const ag = new AntigravityCommands();
  const mine = path.join(root, '.agents', 'workflows', 'graf-map.md');
  await fs.mkdir(path.dirname(mine), { recursive: true }); await fs.writeFile(mine, '---\ndescription: mine\n---\nmy own steps\n');
  const r = await ag.install(root);
  assert.equal(r.skipped.length, 1); assert.equal(r.skipped[0].name, 'graf-map'); assert.equal(r.written.length, 5);
  assert.match(await fs.readFile(mine, 'utf8'), /my own steps/);
  assert.equal((await ag.status(root)).items.find(i => i.name === 'graf-map').state, 'foreign');
  const removed = await ag.remove(root);
  assert.equal(removed.removed.length, 5); assert.equal(removed.kept.length, 1);
  assert.match(await fs.readFile(mine, 'utf8'), /my own steps/, 'still there');
  await assert.rejects(fs.access(path.join(root, '.agents', 'workflows', 'graf.md')));
});

test('an outdated Graf-managed file is detected and updated', async t => {
  const root = await tmp(t); const ag = new AntigravityCommands(); await ag.install(root);
  const file = path.join(root, '.agents', 'workflows', 'graf.md');
  await fs.writeFile(file, `${MARKER}\nold text\n`);
  assert.equal((await ag.status(root)).items.find(i => i.name === 'graf').state, 'outdated');
  assert.equal((await ag.install(root)).written.length, 1);
  assert.equal(await fs.readFile(file, 'utf8'), COMMANDS[0].text);
});

test('install requires an open project', async () => {
  await assert.rejects(new AntigravityCommands().install(undefined), /Open a project/);
});

test('install creates modern Antigravity Skills for autocomplete with branding banner and remove cleans them up', async t => {
  const root = await tmp(t);
  const fakeHome = await tmp(t);
  const ag = new AntigravityCommands({ homeDir: fakeHome });
  await ag.install(root);

  // Check modern skills directory
  for (const cmd of COMMANDS) {
    const skillPath = path.join(root, '.agents', 'skills', cmd.name, 'SKILL.md');
    const content = await fs.readFile(skillPath, 'utf8');
    assert.match(content, new RegExp(`^---\\nname: ${cmd.name}\\ndescription: `), `${cmd.name} has valid skill frontmatter`);
    assert.ok(content.includes(MARKER), `${cmd.name} has marker`);
    assert.match(content, /◈ \*\*GRAF\*\*/, `${cmd.name} contains the Graf logo/branding banner`);
  }

  // Verify removal cleans up skills as well
  await ag.remove(root);
  for (const cmd of COMMANDS) {
    const skillPath = path.join(root, '.agents', 'skills', cmd.name, 'SKILL.md');
    await assert.rejects(fs.access(skillPath), `${cmd.name} skill file should be removed`);
  }
});

