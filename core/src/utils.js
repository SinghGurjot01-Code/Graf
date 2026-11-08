import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const now = () => new Date().toISOString();
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export const id = prefix => `${prefix}_${crypto.randomUUID()}`;
export async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
export async function atomicWrite(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, data);
  await fs.rename(temp, file);
}
export function safeRepoPath(root, relative) {
  if (typeof relative !== 'string' || !relative.trim()) throw new Error('A relative repository path is required.');
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path is outside the repository root.');
  return resolved;
}
export function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2);
      if (inline !== undefined) out[k.replaceAll('-', '_')] = inline;
      else if (args[i + 1] && !args[i + 1].startsWith('--')) out[k.replaceAll('-', '_')] = args[++i];
      else out[k.replaceAll('-', '_')] = true;
    } else out._.push(a);
  }
  return out;
}
