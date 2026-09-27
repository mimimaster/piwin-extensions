// Collect every entry into the published index (schemaVersion 1).
import { validateEntry } from './entry.mjs';
import { readEntries } from './registry-tree.mjs';
import { sortVersionsNewestFirst } from './versions.mjs';

/** Returns { index, problems }; any problem means nothing should be published. */
export async function buildIndex(root, now = new Date()) {
  const { entries, strayFiles } = await readEntries(root);
  const problems = strayFiles.map((path) => `${path}: not an extensions/<owner>/<name>.json entry`);
  const extensions = [];
  for (const [id, item] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
    if (item.parseError) {
      problems.push(`${item.path}: invalid JSON (${item.parseError})`);
      continue;
    }
    const entryProblems = validateEntry(item.entry, id);
    if (entryProblems.length > 0) {
      problems.push(...entryProblems.map((problem) => `${item.path}: ${problem}`));
      continue;
    }
    // `$schema` only serves editors; the index carries registry data only.
    const { $schema: _editorSchema, ...data } = item.entry;
    extensions.push({ id, ...data, versions: sortVersionsNewestFirst(data.versions) });
  }
  return { index: { schemaVersion: 1, generatedAt: now.toISOString(), extensions }, problems };
}
