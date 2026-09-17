import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pub = resolve(root, 'site/public');
const guideSrc = resolve(root, 'docs/guide.md');
const guideDest = resolve(pub, 'guide.md');
const indexMd = resolve(pub, 'index.md');
const llms = resolve(pub, 'llms.txt');
const full = resolve(pub, 'llms-full.txt');

copyFileSync(guideSrc, guideDest);

const parts = [
  readFileSync(llms, 'utf8').trim(),
  readFileSync(indexMd, 'utf8').trim(),
  readFileSync(guideDest, 'utf8').trim(),
];

writeFileSync(
  full,
  `${parts.join('\n\n---\n\n')}\n`,
);

console.log('Synced agent docs: guide.md and llms-full.txt');
