import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Antigravity "Workflows" and "Skills" are markdown files invoked in chat as /name.
 * Graf installs both modern Skills (.agents/skills/<name>/SKILL.md) for slash-command autocomplete
 * and legacy Workflows (.agents/workflows/<name>.md) for backwards compatibility.
 * Every file Graf writes carries a marker, and Graf only ever overwrites or removes files that carry it.
 */
export const MARKER = '<!-- managed-by: graf -->';
export const MAX_FILE_CHARS = 12000; // Antigravity's documented limit per workflow/rule file

const wf = (name, description, body) => ({
  name,
  kind: 'workflow',
  description,
  body: body.trim(),
  text: `---\ndescription: ${description}\n---\n${MARKER}\n\n${body.trim()}\n`
});

export const COMMANDS = [
  wf('graf', 'Stop analyzing files and folders. Use Graf’s project graph instead.', `
# Use Graf, not file scanning

◈ **GRAF** · *Codebase Intelligence*

Understand this project through the Graf MCP server only. The text the user typed after the command is the task.

1. Do not list directories, grep, search or open files to get oriented.
2. Call the Graf \`tree\` tool with depth 2 to see how the project is laid out.
3. Call \`get_context\` with the task in plain words. Add \`include_dependencies: true\` if the change touches other code.
4. If you need exact code, call \`read_node\` with an id Graf returned. Read only that node, never the whole file.
5. If Graf has nothing useful, say so and call \`sync_status\`. Only then open a single file, and tell the user why.
6. Name the Graf results you relied on in your answer.`),
  wf('graf-map', 'Show how this project is organised, using Graf only.', `
# Project map

◈ **GRAF** · *Project Map*

1. Call the Graf \`tree\` tool with mode \`structure\` and depth 3.
2. Call \`overview\` for the module summary.
3. Explain the main folders, entry points and how they connect. Do not open any file.
4. List the 5 most important files by their ids so the user can ask about them next.`),
  wf('graf-find', 'Find where something lives and what uses it, using Graf only.', `
# Find

◈ **GRAF** · *Find Symbol*

The text after the command is the thing to find (a function, class, file or idea).

1. Call \`search\` with it. If there are several matches, list them and ask which one is meant.
2. For the chosen result, call \`neighbors\` to see what it uses and what uses it.
3. Answer with: where it is (file and lines), what it does, who calls it. Do not open files.
4. Offer \`read_node\` if the user wants the exact code.`),
  wf('graf-impact', 'List everything that could break if a symbol changes, using Graf only.', `
# Impact

◈ **GRAF** · *Impact Analysis*

The text after the command is the symbol or file about to change.

1. Call \`search\` to get its id, then \`impact_of\` with that id.
2. Call \`tree\` with mode \`dependents\` and that id for the dependency chain.
3. Report: files and symbols that depend on it, grouped by how directly they depend on it.
4. Say which of them you would check first. Do not edit anything yet.`),
  wf('graf-sync', 'Check whether Graf’s graph is fresh and refresh it if not.', `
# Graf sync

◈ **GRAF** · *Sync Status*

1. Call \`sync_status\`.
2. If the graph is stale or files changed since the last update, tell the user Graf updates automatically while Graf Desktop or the MCP server is running, and report the numbers.
3. Do not scan the project yourself to compensate.`),
  wf('graf-report', 'Log this task’s real token and time cost so Graf can show savings.', `
# Report usage

◈ **GRAF** · *Usage Report*

1. Work out roughly how many tokens and how many milliseconds the task just finished used. Use real numbers only; if you do not know them, say so and stop.
2. Call \`report_usage\` with \`task\` (a short title), \`tokens_used\`, \`duration_ms\`, and \`with_graf: true\`.
3. Confirm to the user that it was recorded.`)
];

export const RULE = {
  name: 'graf', kind: 'rule', description: 'Always prefer Graf for understanding the project.',
  text: `${MARKER}\n# Prefer Graf\n\nThis project is indexed by Graf (MCP server "graf"). Before listing folders, searching or reading files to understand the code, call Graf first: \`tree\` for structure, \`get_context\` for a task, \`search\` and \`neighbors\` to find things, \`read_node\` for exact lines. Open a file directly only when Graf has nothing useful, and say why.\n`
};

export class AntigravityCommands {
  constructor({ homeDir = os.homedir() } = {}) {
    this.homeDir = homeDir;
  }

  /** The project's config folder. An existing .agents wins, then a legacy .agent, otherwise .agents (Antigravity's default). */
  baseDir(projectRoot) {
    if (!projectRoot) throw new Error('Open a project first.');
    for (const name of ['.agents', '.agent']) if (existsSync(path.join(projectRoot, name))) return path.join(projectRoot, name);
    return path.join(projectRoot, '.agents');
  }

  fileFor(projectRoot, item) {
    return path.join(this.baseDir(projectRoot), item.kind === 'rule' ? 'rules' : 'workflows', `${item.name}.md`);
  }

  skillFileFor(projectRoot, item) {
    return path.join(this.baseDir(projectRoot), 'skills', item.name, 'SKILL.md');
  }

  skillTextFor(item) {
    return `---\nname: ${item.name}\ndescription: ${item.description}\n---\n${MARKER}\n\n${(item.body || '').trim()}\n`;
  }

  async inspect(file, item) {
    let current; try { current = await fs.readFile(file, 'utf8'); } catch { return { state: 'missing' }; }
    if (!current.includes(MARKER)) return { state: 'foreign' };           // the user's own file with the same name
    return { state: current === item.text ? 'installed' : 'outdated' };
  }

  async status(projectRoot) {
    const items = [...COMMANDS, RULE];
    const rows = [];
    for (const item of items) {
      const file = this.fileFor(projectRoot, item);
      rows.push({
        name: item.name,
        kind: item.kind,
        command: item.kind === 'workflow' ? `/${item.name}` : null,
        description: item.description,
        file,
        ...(await this.inspect(file, item))
      });
    }
    return { baseDir: this.baseDir(projectRoot), items: rows };
  }

  async install(projectRoot, { rule = false } = {}) {
    const items = rule ? [...COMMANDS, RULE] : COMMANDS;
    const written = [], skipped = [];
    for (const item of items) {
      if (item.text.length > MAX_FILE_CHARS) throw new Error(`${item.name} is longer than Antigravity’s ${MAX_FILE_CHARS} character limit.`);
      const file = this.fileFor(projectRoot, item);
      const { state } = await this.inspect(file, item);
      if (state === 'foreign') {
        skipped.push({ name: item.name, file, reason: 'A file with this name already exists and was not written by Graf, so it was left alone.' });
        continue;
      }
      if (state !== 'installed') {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        await fs.writeFile(tmp, item.text, 'utf8');
        await fs.rename(tmp, file);
        written.push({ name: item.name, file });
      }

      // If workflow command, also install modern Antigravity Skill in .agents/skills/<name>/SKILL.md
      if (item.kind === 'workflow') {
        const skillFile = this.skillFileFor(projectRoot, item);
        const skillText = this.skillTextFor(item);
        let skillCurrent;
        try { skillCurrent = await fs.readFile(skillFile, 'utf8'); } catch {}
        if (!skillCurrent || skillCurrent.includes(MARKER)) {
          if (skillCurrent !== skillText) {
            await fs.mkdir(path.dirname(skillFile), { recursive: true });
            const sTmp = `${skillFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
            await fs.writeFile(sTmp, skillText, 'utf8');
            await fs.rename(sTmp, skillFile);
          }
        }
      }
    }

    // Also mirror to global ~/.gemini/config/skills if ~/.gemini/config exists so commands are available globally
    const globalSkillsDir = path.join(this.homeDir, '.gemini', 'config', 'skills');
    if (existsSync(path.dirname(globalSkillsDir))) {
      for (const item of COMMANDS) {
        try {
          const gSkillFile = path.join(globalSkillsDir, item.name, 'SKILL.md');
          const skillText = this.skillTextFor(item);
          let gCurrent;
          try { gCurrent = await fs.readFile(gSkillFile, 'utf8'); } catch {}
          if (!gCurrent || gCurrent.includes(MARKER)) {
            if (gCurrent !== skillText) {
              await fs.mkdir(path.dirname(gSkillFile), { recursive: true });
              await fs.writeFile(gSkillFile, skillText, 'utf8');
            }
          }
        } catch {}
      }
    }

    return { written, skipped, baseDir: this.baseDir(projectRoot) };
  }

  /** Removes only files that carry Graf's marker; empty folders Graf created are left in place. */
  async remove(projectRoot) {
    const removed = [], kept = [];
    for (const item of [...COMMANDS, RULE]) {
      const file = this.fileFor(projectRoot, item);
      const { state } = await this.inspect(file, item);
      if (state === 'foreign') {
        kept.push({ name: item.name, file });
        continue;
      }
      if (state !== 'missing') {
        await fs.rm(file, { force: true });
        removed.push({ name: item.name, file });
      }

      // Also clean up skill file if managed by Graf
      if (item.kind === 'workflow') {
        const skillFile = this.skillFileFor(projectRoot, item);
        let skillContent;
        try { skillContent = await fs.readFile(skillFile, 'utf8'); } catch {}
        if (skillContent && skillContent.includes(MARKER)) {
          await fs.rm(skillFile, { force: true });
          await fs.rm(path.dirname(skillFile), { recursive: true, force: true }).catch(() => {});
        }
      }
    }
    return { removed, kept };
  }
}
