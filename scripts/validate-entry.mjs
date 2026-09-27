#!/usr/bin/env node
// Check entry files on their own: path, JSON form, rules, and (unless
// --skip-fetch) the pinned source of every version. Read-only throughout.
//
//   node scripts/validate-entry.mjs extensions/alice/tool.json [more.json …] [--skip-fetch]
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { isFormattedEntry, parseEntryPath, validateEntry } from './lib/entry.mjs';
import { checkPinnedSource } from './lib/source-check.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'skip-fetch': { type: 'boolean', default: false } },
});
if (positionals.length === 0) {
  console.error('usage: validate-entry.mjs <extensions/<owner>/<name>.json>… [--skip-fetch]');
  process.exit(2);
}

let failed = 0;
for (const file of positionals) {
  const problems = await validateFile(file, !values['skip-fetch']);
  if (problems.length === 0) {
    console.log(`✓ ${file}`);
  } else {
    failed += 1;
    console.log(`✗ ${file}`);
    for (const problem of problems) console.log(`    ${problem}`);
  }
}
process.exit(failed > 0 ? 1 : 0);

async function validateFile(file, fetchSources) {
  // The id comes from the last `extensions/<owner>/<name>.json` of the path, so
  // fixtures such as schema/fixtures/valid/extensions/… work too.
  const segments = file.split(/[\\/]/);
  const tail = segments.slice(-3).join('/');
  const parsedPath = parseEntryPath(tail);
  if (!parsedPath) return ['path must end in extensions/<owner>/<name>.json with valid handles'];
  let raw;
  let entry;
  try {
    raw = await readFile(file, 'utf8');
    entry = JSON.parse(raw);
  } catch (error) {
    return [`cannot read JSON: ${error.message}`];
  }
  const problems = validateEntry(entry, parsedPath.id);
  if (!isFormattedEntry(raw, entry)) problems.push('format as 2-space JSON with a trailing newline (npm run format)');
  if (problems.length > 0 || !fetchSources) return problems;
  for (const version of entry.versions) {
    for (const problem of await checkPinnedSource({
      repository: entry.repository,
      commit: version.commit,
      subdir: entry.subdir,
    })) {
      problems.push(`${version.version}: ${problem}`);
    }
  }
  return problems;
}
