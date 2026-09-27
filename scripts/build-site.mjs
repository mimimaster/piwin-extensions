#!/usr/bin/env node
// Assemble the Pages artifact: site/ + the shared rule modules + index.json +
// the entry schema. The site imports ./lib/entry.mjs, the same file the CI runs.
//
//   node scripts/build-site.mjs [out=dist] [--index-root <dir>]   (index-root defaults to .)
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildIndex } from './lib/build-index.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'index-root': { type: 'string', default: repoRoot } },
});
const out = positionals[0] ?? join(repoRoot, 'dist');

const { index, problems } = await buildIndex(values['index-root']);
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
await rm(out, { recursive: true, force: true });
await cp(join(repoRoot, 'site'), out, { recursive: true });
await mkdir(join(out, 'lib'), { recursive: true });
await mkdir(join(out, 'schema'), { recursive: true });
// The browser runs the CI's own rule modules; both are free of Node APIs.
await cp(join(repoRoot, 'scripts/lib/entry.mjs'), join(out, 'lib/entry.mjs'));
await cp(join(repoRoot, 'scripts/lib/source-rules.mjs'), join(out, 'lib/source-rules.mjs'));
await cp(join(repoRoot, 'schema/entry.schema.json'), join(out, 'schema/entry.schema.json'));
await writeFile(join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
await writeFile(join(out, '.nojekyll'), '');
console.log(`site with ${index.extensions.length} extension(s) → ${out}`);
