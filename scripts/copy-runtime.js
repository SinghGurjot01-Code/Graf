import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules', 'node', 'bin', 'node.exe');
const target = path.join(root, 'runtime', 'win-x64', 'node.exe');
await fs.mkdir(path.dirname(target), { recursive: true });
try {
  await fs.copyFile(source, target);
  console.log('Bundled standalone Node.js runtime for the MCP server.');
} catch (error) {
  if (error.code === 'ENOENT') throw new Error('Standalone Node runtime is missing. Run npm install first, then npm run prepare:runtime.');
  throw error;
}
