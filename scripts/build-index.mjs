#!/usr/bin/env node
// Build <out>/index.json from <root>/extensions. Fails on any invalid entry so
// a bad merge never publishes.
//
//   node scripts/build-index.mjs [root=.] [out=dist]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildIndex } from './lib/build-index.mjs';

const root = process.argv[2] ?? '.';
const outDir = process.argv[3] ?? join(root, 'dist');
const { index, problems } = await buildIndex(root);
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${index.extensions.length} extension(s) to ${join(outDir, 'index.json')}`);
