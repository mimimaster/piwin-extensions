#!/usr/bin/env node
// Build dist/index.json from every entry. Fails on any invalid entry so a bad
// merge never publishes. Output shape: ExtensionRegistryIndex (schemaVersion 1).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateEntry } from './lib/entry.mjs';
import { readEntries } from './lib/registry-tree.mjs';

const root = process.argv[2] ?? '.';
const outDir = process.argv[3] ?? join(root, 'dist');
const { entries, strayFiles } = await readEntries(root);
const problems = strayFiles.map((path) => `${path}: not an extensions/<owner>/<name>.json entry`);
const extensions = [];
for (const [id, item] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
  if (item.parseError) {
    problems.push(`${item.path}: invalid JSON (${item.parseError})`);
    continue;
  }
  const entryProblems = validateEntry(item.entry);
  if (entryProblems.length > 0) {
    problems.push(...entryProblems.map((problem) => `${item.path}: ${problem}`));
    continue;
  }
  // `$schema` only serves editors; the index carries registry data only.
  const { $schema: _editorSchema, ...data } = item.entry;
  extensions.push({ id, ...data });
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
const index = { schemaVersion: 1, generatedAt: new Date().toISOString(), extensions };
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${extensions.length} extension(s) to ${join(outDir, 'index.json')}`);
