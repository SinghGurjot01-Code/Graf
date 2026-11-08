import path from 'node:path';
import { sha } from '../utils.js';
import { parseJsAst } from './js-ast.js';
import { parseMarkup } from './markup.js';
import { parseCss } from './css.js';
import { parseSfc } from './sfc.js';

export const SUPPORTED_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  '.html', '.css', '.scss', '.vue', '.svelte',
  '.py', '.java', '.cs', '.go', '.env', '.yaml', '.yml', '.toml', '.example'
]);

const SKIP_DIRS = new Set([
  '.git', '.graf', 'node_modules', 'dist', 'build', 'coverage',
  '.next', 'vendor', 'target', 'bin', 'obj', '.venv', 'venv', '__pycache__'
]);

const SECRET_FILE = /(^|\/)(\.env(?:\.(?!example$|sample$|template$)[^/]*)?|id_rsa|id_ed25519|.*\.(pem|key|p12|pfx))$/i;

export const SECRET_VALUE = /(api[_-]?key|secret|token|password|private[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?[^\s'";,]+|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/ig;

export function containsSecret(value) {
  SECRET_VALUE.lastIndex = 0;
  return SECRET_VALUE.test(String(value || ''));
}

export function shouldIgnore(rel, ignoreText = '') {
  const p = rel.replaceAll('\\', '/');
  if (SECRET_FILE.test(p) || p.split('/').some(x => SKIP_DIRS.has(x))) return true;
  if (/\.(lock|min)\./i.test(p) || /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(p)) return true;
  return ignoreText.split(/\r?\n/).some(line => {
    const s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith('!')) return false;
    const rule = s.replace(/^\//, '').replace(/\/$/, '');
    return p === rule || p.startsWith(rule + '/') || (rule.startsWith('*.') && p.endsWith(rule.slice(1)));
  });
}

function languageFor(ext, relPath = '') {
  if (/^\.env\.(example|sample|template)$/i.test(path.basename(relPath))) return 'dotenv';
  const map = {
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
    '.html': 'html', '.css': 'css', '.scss': 'scss', '.vue': 'vue', '.svelte': 'svelte',
    '.py': 'python', '.java': 'java', '.cs': 'csharp', '.go': 'go',
    '.env': 'dotenv', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.example': 'dotenv'
  };
  return map[ext] || 'javascript';
}

function mask(source, lang) {
  if (['yaml', 'toml', 'dotenv'].includes(lang)) return source;
  let out = '', i = 0, state = 'code', quote = '', triple = false;
  while (i < source.length) {
    const c = source[i], n = source[i + 1], n2 = source[i + 2];
    if (state === 'code') {
      if (lang === 'python' && c === '#') { out += ' '; i++; state = 'line'; continue; }
      if (c === '/' && n === '/') { out += '  '; i += 2; state = 'line'; continue; }
      if (c === '/' && n === '*') { out += '  '; i += 2; state = 'block'; continue; }
      if (c === "'" || c === '"' || (c === '`' && lang !== 'python')) {
        quote = c; triple = lang === 'python' && n === c && n2 === c;
        const count = triple ? 3 : 1; out += ' '.repeat(count); i += count; state = 'string'; continue;
      }
      out += c; i++; continue;
    }
    if (state === 'line') { if (c === '\n') { out += '\n'; state = 'code'; } else out += ' '; i++; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { out += '  '; i += 2; state = 'code'; } else { out += c === '\n' ? '\n' : ' '; i++; } continue; }
    if (c === '\\') { out += ' '; i++; if (i < source.length) { out += source[i] === '\n' ? '\n' : ' '; i++; } continue; }
    if (triple && c === quote && n === quote && n2 === quote) { out += '   '; i += 3; state = 'code'; triple = false; continue; }
    if (!triple && c === quote) { out += ' '; i++; state = 'code'; continue; }
    out += c === '\n' ? '\n' : ' '; i++;
  }
  return out;
}

const lineAt = (s, i) => s.slice(0, i).split('\n').length;

function endLine(clean, source, start, lang) {
  if (lang === 'python') {
    const ls = source.split('\n'), n = lineAt(source, start);
    let end = n;
    for (let i = n; i < ls.length; i++) {
      if (ls[i].trim() && !/^\s/.test(ls[i])) break;
      end = i + 1;
    }
    return end;
  }
  const open = clean.indexOf('{', start);
  if (open < 0 || open - start > 300) return lineAt(source, Math.max(start, source.indexOf('\n', start)));
  let d = 0;
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') d++;
    else if (clean[i] === '}' && --d === 0) return lineAt(source, i);
  }
  return lineAt(source, source.length);
}

function summary(name, sig, source, start) {
  const before = source.slice(Math.max(0, start - 300), start);
  const doc = before.match(/\/\*\*([\s\S]*?)\*\/\s*$/) || before.match(/(?:\/\/|#)\s*([^\n]+)\s*$/);
  return (doc?.[1] || doc?.[2] || `${name}: ${sig}`).replace(/[\s*]+/g, ' ').trim().slice(0, 180);
}

function addNode(nodes, edges, fileId, rel, source, clean, kind, name, start, sig, lang, qualifier = '') {
  const line = lineAt(source, start), base = `${kind}:${rel}#${qualifier ? qualifier + '.' : ''}${name}`, id = base;
  if (nodes.some(n => n.id === id)) return;
  nodes.push({
    id,
    kind,
    path: rel,
    name,
    qualifiedName: qualifier ? `${qualifier}.${name}` : name,
    signature: sig.trim().slice(0, 240),
    lineStart: line,
    lineEnd: endLine(clean, source, start, lang),
    summary: summary(name, sig, source, start),
    provenance: 'verified',
    confidence: 1
  });
  edges.push({ src: fileId, dst: id, type: 'defines', provenance: 'verified', confidence: 1 });
}

function parseNonWeb(relPath, source, lang, fileId) {
  const clean = mask(source, lang), lines = source.split('\n'), nodes = [], edges = [];
  const patterns = {
    python: [['class', /^\s*class\s+(\w+)/gm], ['function', /^\s*(?:async\s+)?def\s+(\w+)\s*\([^)]*\)/gm]],
    java: [['class', /\b(?:class|interface|enum|record)\s+(\w+)/g], ['function', /\b(?:public|protected|private|static|final|synchronized|\w[\w<>\[\].?]*\s+)+\s+(\w+)\s*\([^;{}]*\)\s*(?:throws\s+[\w, ]+)?\{/g]],
    csharp: [['class', /\b(?:class|interface|struct|record|enum)\s+(\w+)/g], ['function', /\b(?:public|private|protected|internal|static|async|virtual|override|\w[\w<>\[\].?]*\s+)+\s+(\w+)\s*\([^;{}]*\)\s*\{/g]],
    go: [['class', /\btype\s+(\w+)\s+struct\b/g], ['function', /\bfunc\s+(?:\([^)]*\)\s*)?(\w+)\s*\([^)]*\)/g]]
  }[lang] || [];

  const found = [];
  for (const [kind, re] of patterns) {
    let m;
    while ((m = re.exec(clean))) {
      const name = m[1];
      if (['if', 'for', 'while', 'switch', 'catch', 'with', 'return'].includes(name)) continue;
      const start = m.index;
      const line = lineAt(source, start);
      if (found.some(x => x.kind === kind && x.name === name && x.line === line)) continue;
      const sig = source.slice(start, Math.min(source.length, source.indexOf('\n', start) < 0 ? source.length : source.indexOf('\n', start))).trim();
      found.push({ kind, name, start, line, sig });
    }
  }

  let currentClass = '';
  for (const s of found.sort((a, b) => a.start - b.start)) {
    if (s.kind === 'class') currentClass = s.name;
    addNode(nodes, edges, fileId, relPath, source, clean, s.kind, s.name, s.start, s.sig, lang, currentClass && s.kind === 'function' ? currentClass : '');
  }

  if (['dotenv', 'yaml', 'toml'].includes(lang)) {
    const keyRe = lang === 'dotenv' ? /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm : lang === 'yaml' ? /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*:/gm : /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=/gm;
    let cm;
    while ((cm = keyRe.exec(source))) {
      const key = cm[1], id = `config:${relPath}#${key}`;
      if (nodes.some(n => n.id === id)) continue;
      nodes.push({ id, kind: 'config', path: relPath, name: key, keyName: key, lineStart: lineAt(source, cm.index), lineEnd: lineAt(source, cm.index), summary: `Configuration key ${key}`, provenance: 'verified', confidence: 1 });
      edges.push({ src: fileId, dst: id, type: 'defines', provenance: 'verified', confidence: 1 });
    }
  }

  const importRes = lang === 'python' ? [/^\s*from\s+([\w.]+)\s+import/gm, /^\s*import\s+([\w.]+)/gm] : lang === 'java' ? [/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm] : lang === 'csharp' ? [/^\s*using\s+([\w.]+)\s*;/gm] : lang === 'go' ? [/\bimport\s+\"([^\"]+)\"/g, /\b\w+\s+\"([^\"]+)\"/g] : [];
  for (const re of importRes) {
    let m;
    while ((m = re.exec(source))) {
      const target = m[1];
      edges.push({ src: fileId, dst: `module:${target}`, type: 'imports', provenance: 'inferred', confidence: .75 });
    }
  }

  const modelRe = /\b(?:modelBuilder\.Entity|DbSet\s*<)\b/g;
  let mm;
  while ((mm = modelRe.exec(clean))) {
    const name = `Model@${lineAt(source, mm.index)}`, id = `model:${relPath}#${name}`;
    nodes.push({ id, kind: 'model', path: relPath, name, lineStart: lineAt(source, mm.index), lineEnd: lineAt(source, mm.index), summary: 'Potential data model declaration', provenance: 'inferred', confidence: .55 });
    edges.push({ src: fileId, dst: id, type: 'defines', provenance: 'inferred', confidence: .55 });
  }

  const funcs = nodes.filter(n => n.kind === 'function');
  for (const fn of funcs) {
    const body = clean.split('\n').slice(fn.lineStart - 1, Math.min(lines.length, fn.lineEnd)).join('\n');
    for (const target of funcs) {
      if (target.id === fn.id) continue;
      if (new RegExp(`\\b${target.name}\\s*\\(`).test(body)) {
        edges.push({ src: fn.id, dst: target.id, type: 'calls', provenance: 'inferred', confidence: .55 });
      }
    }
  }

  return { nodes, edges, imports: [], exports: [], unresolvedCalls: [], domQueries: [], parseOk: true };
}

export function parseSource(relPath, source, language) {
  const ext = path.extname(relPath).toLowerCase();
  const lang = language || languageFor(ext, relPath);
  const lines = source.split('\n');
  const fileId = `file:${relPath}`;

  const fileNode = {
    id: fileId,
    kind: 'file',
    path: relPath,
    name: path.basename(relPath),
    language: lang,
    size: Buffer.byteLength(source),
    contentHash: sha(source),
    lineStart: 1,
    lineEnd: lines.length,
    summary: `${lang} source file (${lines.length} lines)`,
    provenance: 'verified',
    confidence: 1
  };

  let subResult;
  try {
    if (lang === 'javascript' || lang === 'typescript') {
      const isTs = lang === 'typescript' || ['.ts', '.tsx', '.mts', '.cts'].includes(ext);
      const isJsx = ['.jsx', '.tsx'].includes(ext);
      subResult = parseJsAst(relPath, source, { language: lang, isTs, isJsx });
    } else if (lang === 'html') {
      subResult = parseMarkup(relPath, source, { language: lang });
    } else if (lang === 'css' || lang === 'scss') {
      subResult = parseCss(relPath, source, { language: lang, isScss: lang === 'scss' });
    } else if (lang === 'vue' || lang === 'svelte') {
      subResult = parseSfc(relPath, source, { language: lang });
    } else {
      subResult = parseNonWeb(relPath, source, lang, fileId);
    }
  } catch (err) {
    if (['javascript', 'typescript'].includes(lang)) {
      try {
        subResult = parseNonWeb(relPath, source, lang, fileId);
        subResult.parseOk = false;
      } catch {
        subResult = { nodes: [], edges: [], imports: [], exports: [], unresolvedCalls: [], domQueries: [], parseOk: false };
      }
    } else {
      subResult = { nodes: [], edges: [], imports: [], exports: [], unresolvedCalls: [], domQueries: [], parseOk: false };
    }
  }

  // Ensure fileNode is always first element in nodes array
  const nodes = subResult.nodes && subResult.nodes.length > 0 && subResult.nodes[0].id === fileId
    ? subResult.nodes
    : [fileNode, ...(subResult.nodes || [])];

  const edges = subResult.edges || [];

  return {
    nodes,
    edges,
    imports: subResult.imports || [],
    exports: subResult.exports || [],
    unresolvedCalls: subResult.unresolvedCalls || [],
    domQueries: subResult.domQueries || [],
    language: lang,
    hash: sha(source),
    parseOk: subResult.parseOk !== false
  };
}

export { SECRET_FILE };
