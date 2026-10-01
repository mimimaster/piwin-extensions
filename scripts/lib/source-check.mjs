// Fetch one pinned commit and check the tree piwin will stage. Nothing from
// the fetched tree is executed: git fetch runs no hooks, and we only read.
// The rules themselves live in source-rules.mjs (shared with the web front end).
import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { checkPackageJsonText, checkSourceListing, readSessionBackend } from './source-rules.mjs';

export { SOURCE_LIMITS } from './source-rules.mjs';

const run = promisify(execFile);

/** Returns problems for `repository@commit[/subdir]`; empty means stageable. */
export async function checkPinnedSource({ repository, commit, subdir }) {
  const workdir = await mkdtemp(join(tmpdir(), 'piwin-registry-check-'));
  try {
    await run('git', ['init', '-q', workdir]);
    try {
      await run('git', ['fetch', '-q', '--depth', '1', '--', repository, commit], {
        cwd: workdir,
        timeout: 120_000,
      });
    } catch {
      return [`cannot fetch ${repository} at ${commit}; is the repository public and the commit pushed?`];
    }
    await run('git', ['checkout', '-q', '--detach', 'FETCH_HEAD'], { cwd: workdir });
    return await checkTree(workdir, subdir);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

/** Structural rules that match piwin's managed extension staging. */
export async function checkTree(root, subdir) {
  const listing = [];
  await walk(root, root, listing);
  const result = checkSourceListing(listing, subdir);
  const problems = [...result.problems];
  if (result.packageJsonPath) {
    problems.push(...checkPackageJsonText(await readFile(join(root, result.packageJsonPath), 'utf8')));
  }
  if (result.kind !== 'dir') return problems;
  if (!result.manifestPath) return problems;
  const backend = readSessionBackend(await readFile(join(root, result.manifestPath), 'utf8'));
  if (result.requiresBackend && backend.entrypoint === null && backend.problems.length === 0) {
    problems.push(`${subdir ?? 'repository root'} has no index.ts and piwin.json declares no sessionBackend`);
  }
  problems.push(...backend.problems);
  if (backend.entrypoint !== null) {
    const prefix = subdir ? `${subdir}/` : '';
    const artifactPath = `${prefix}${backend.entrypoint}`;
    if (!listing.some((item) => item.path === artifactPath && item.kind === 'file')) {
      problems.push(`declared sessionBackend artifact is missing: ${backend.entrypoint}`);
    }
  }
  return problems;
}

/** lstat walk: symlinks are reported, never followed; node_modules is not entered. */
async function walk(root, directory, listing) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name === '.git') continue;
    const path = join(directory, item.name);
    const posixPath = relative(root, path).split('\\').join('/');
    const itemStat = await lstat(path);
    if (itemStat.isSymbolicLink()) {
      listing.push({ path: posixPath, kind: 'symlink' });
    } else if (itemStat.isDirectory()) {
      listing.push({ path: posixPath, kind: 'dir' });
      if (item.name !== 'node_modules') await walk(root, path, listing);
    } else {
      listing.push({ path: posixPath, kind: 'file', size: itemStat.size });
    }
  }
}
