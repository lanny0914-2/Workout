import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const distDir = 'dist';
const indexPath = join(distDir, 'index.html');

if (!existsSync(indexPath)) {
  throw new Error('dist/index.html is missing');
}

const html = readFileSync(indexPath, 'utf8');
const refs = [];
const attrPattern = /\b(?:src|href)=["']([^"']+)["']/gi;
let match;

while ((match = attrPattern.exec(html))) {
  const ref = match[1].trim();
  if (!ref || ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) {
    continue;
  }
  refs.push(ref.split(/[?#]/, 1)[0]);
}

const missing = [];
for (const ref of refs) {
  const normalized = normalize(ref.startsWith('/') ? ref.slice(1) : ref);
  if (normalized.startsWith('..')) {
    missing.push(ref);
    continue;
  }
  const target = join(distDir, normalized);
  if (!existsSync(target)) {
    missing.push(ref);
  }
}

if (missing.length) {
  throw new Error(`dist/index.html references missing local assets: ${missing.join(', ')}`);
}

console.log(`Validated dist/index.html local assets from ${dirname(indexPath)}.`);
