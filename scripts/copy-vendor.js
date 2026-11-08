import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js');
const target = path.join(root, 'src', 'renderer', 'vendor', 'cytoscape.min.js');
await fs.mkdir(path.dirname(target), { recursive: true });
try {
  await fs.copyFile(source, target);
  console.log('Prepared Cytoscape renderer bundle.');
} catch (error) {
  if (error.code === 'ENOENT') throw new Error('Cytoscape is not installed. Run npm install first.');
  throw error;
}
