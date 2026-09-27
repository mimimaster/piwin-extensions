#!/usr/bin/env node
// Rewrite every entry as 2-space JSON with a trailing newline (what CI expects).
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readEntries } from './lib/registry-tree.mjs';

const root = process.argv[2] ?? '.';
const { entries } = await readEntries(root);
for (const item of entries.values()) {
  if (item.parseError) {
    console.error(`skip ${item.path}: ${item.parseError}`);
    continue;
  }
  const formatted = `${JSON.stringify(item.entry, null, 2)}\n`;
  if (formatted !== item.raw) {
    await writeFile(join(root, item.path), formatted);
    console.log(`formatted ${item.path}`);
  }
}
