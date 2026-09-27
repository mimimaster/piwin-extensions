// Read every entry of a registry checkout and diff two checkouts.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseEntryPath } from './entry.mjs';

/** All files under `root` (POSIX-relative), skipping `.git`. */
export async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name === '.git') continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) await visit(path);
      else files.push(relative(root, path).split('\\').join('/'));
    }
  }
  await visit(root);
  return files.sort();
}

/**
 * Map of entry id → { path, raw, entry | undefined, parseError | undefined }
 * for every `extensions/<owner>/<name>.json`; other files under extensions/
 * are reported as `strayFiles`.
 */
export async function readEntries(root) {
  const entries = new Map();
  const strayFiles = [];
  for (const path of await listFiles(root)) {
    if (!path.startsWith('extensions/')) continue;
    if (path === 'extensions/README.md') continue;
    const parsedPath = parseEntryPath(path);
    if (!parsedPath) {
      strayFiles.push(path);
      continue;
    }
    const raw = await readFile(join(root, path), 'utf8');
    try {
      entries.set(parsedPath.id, { path, raw, entry: JSON.parse(raw), ...parsedPath });
    } catch (error) {
      entries.set(parsedPath.id, { path, raw, parseError: String(error), ...parsedPath });
    }
  }
  return { entries, strayFiles };
}

/** Files that differ between two checkouts (added, removed, or changed). */
export async function changedFiles(baseRoot, headRoot) {
  const [baseFiles, headFiles] = await Promise.all([listFiles(baseRoot), listFiles(headRoot)]);
  const all = new Set([...baseFiles, ...headFiles]);
  const changed = [];
  for (const path of [...all].sort()) {
    const [base, head] = await Promise.all([
      readFile(join(baseRoot, path), 'utf8').catch(() => null),
      readFile(join(headRoot, path), 'utf8').catch(() => null),
    ]);
    if (base !== head) changed.push(path);
  }
  return changed;
}
