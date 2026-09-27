// Fetch one pinned commit and check the tree piwin will stage. Nothing from
// the fetched tree is executed: git fetch runs no hooks, and we only read.
import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const SOURCE_LIMITS = { maxFiles: 2000, maxBytes: 5 * 1024 * 1024 };
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];

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
  const problems = [];
  const target = subdir ? join(root, subdir) : root;
  let targetStat;
  try {
    targetStat = await lstat(target);
  } catch {
    return [`subdir "${subdir}" does not exist at this commit`];
  }
  if (targetStat.isSymbolicLink()) return ['the extension path is a symbolic link'];
  if (targetStat.isFile()) {
    if (!target.endsWith('.ts') || target.endsWith('.d.ts')) problems.push('a file extension must be a .ts module');
    if (targetStat.size > SOURCE_LIMITS.maxBytes) problems.push('extension file is larger than 5 MB');
    return problems;
  }
  try {
    await lstat(join(target, 'index.ts'));
  } catch {
    problems.push(`${subdir ?? 'repository root'} has no index.ts`);
  }
  const totals = { files: 0, bytes: 0 };
  await walk(target, totals, problems);
  if (totals.files > SOURCE_LIMITS.maxFiles) problems.push(`more than ${SOURCE_LIMITS.maxFiles} files`);
  if (totals.bytes > SOURCE_LIMITS.maxBytes) problems.push('source is larger than 5 MB');
  problems.push(...(await checkPackageJson(join(target, 'package.json'))));
  return problems;
}

async function walk(directory, totals, problems) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name === '.git') continue;
    const path = join(directory, item.name);
    const itemStat = await lstat(path);
    if (itemStat.isSymbolicLink()) {
      problems.push(`symbolic link not allowed: ${item.name}`);
    } else if (itemStat.isDirectory()) {
      if (item.name === 'node_modules') problems.push('node_modules must not be committed');
      else await walk(path, totals, problems);
    } else {
      totals.files += 1;
      totals.bytes += itemStat.size;
    }
  }
}

async function checkPackageJson(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return ['package.json is not valid JSON'];
  }
  const problems = [];
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    problems.push(
      'package.json has dependencies; piwin stages source without npm install — bundle them or use peerDependencies for Pi packages',
    );
  }
  for (const script of INSTALL_SCRIPTS) {
    if (pkg.scripts && typeof pkg.scripts[script] === 'string') {
      problems.push(`package.json defines a "${script}" script; install scripts are not allowed`);
    }
  }
  return problems;
}
