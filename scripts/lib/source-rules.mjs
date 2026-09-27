// Source-shape rules for a pinned extension tree, as pure functions over a
// file listing. The CI builds the listing from a `git fetch` checkout
// (source-check.mjs); the web front end builds it from GitHub's tree API.
// No Node APIs here: build-site publishes this file next to entry.mjs.

export const SOURCE_LIMITS = { maxFiles: 2000, maxBytes: 5 * 1024 * 1024 };
export const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];

/**
 * @param {Array<{ path: string, kind: 'file' | 'dir' | 'symlink', size?: number }>} listing
 *   every entry of the tree, POSIX paths relative to the repository root
 * @param {string | undefined} subdir
 * @returns {{ problems: string[], packageJsonPath: string | null, kind: 'file' | 'dir' | null }}
 */
export function checkSourceListing(listing, subdir) {
  const target = subdir ?? '';
  if (target) {
    const entry = listing.find((item) => item.path === target);
    if (!entry) return { problems: [`subdir "${subdir}" does not exist at this commit`], packageJsonPath: null, kind: null };
    if (entry.kind === 'symlink') return { problems: ['the extension path is a symbolic link'], packageJsonPath: null, kind: null };
    if (entry.kind === 'file') {
      const problems = [];
      if (!target.endsWith('.ts') || target.endsWith('.d.ts')) problems.push('a file extension must be a .ts module');
      if ((entry.size ?? 0) > SOURCE_LIMITS.maxBytes) problems.push('extension file is larger than 5 MB');
      return { problems, packageJsonPath: null, kind: 'file' };
    }
  }
  const prefix = target ? `${target}/` : '';
  const problems = [];
  const inside = listing.filter(
    (item) => item.path.startsWith(prefix) && !item.path.slice(prefix.length).split('/').includes('.git'),
  );
  if (!inside.some((item) => item.path === `${prefix}index.ts` && item.kind === 'file')) {
    problems.push(`${subdir ?? 'repository root'} has no index.ts`);
  }
  let files = 0;
  let bytes = 0;
  for (const item of inside) {
    const relativePath = item.path.slice(prefix.length);
    if (item.kind === 'symlink') {
      problems.push(`symbolic link not allowed: ${relativePath}`);
    } else if (item.kind === 'dir' && relativePath.split('/').pop() === 'node_modules') {
      problems.push('node_modules must not be committed');
    } else if (item.kind === 'file' && !relativePath.split('/').includes('node_modules')) {
      files += 1;
      bytes += item.size ?? 0;
    }
  }
  if (files > SOURCE_LIMITS.maxFiles) problems.push(`more than ${SOURCE_LIMITS.maxFiles} files`);
  if (bytes > SOURCE_LIMITS.maxBytes) problems.push('source is larger than 5 MB');
  const packageJsonPath = `${prefix}package.json`;
  return {
    problems,
    packageJsonPath: inside.some((item) => item.path === packageJsonPath && item.kind === 'file') ? packageJsonPath : null,
    kind: 'dir',
  };
}

/** Rules for the extension's package.json text. */
export function checkPackageJsonText(raw) {
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return ['package.json is not valid JSON'];
  }
  const problems = [];
  if (pkg && pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    problems.push(
      'package.json has dependencies; piwin stages source without npm install — bundle them or use peerDependencies for Pi packages',
    );
  }
  for (const script of INSTALL_SCRIPTS) {
    if (pkg && pkg.scripts && typeof pkg.scripts[script] === 'string') {
      problems.push(`package.json defines a "${script}" script; install scripts are not allowed`);
    }
  }
  return problems;
}

/**
 * Directories (or the root, as '') that look like a stageable extension:
 * they contain index.ts. Shallow ones first; node_modules and dot dirs skipped.
 */
export function findExtensionRoots(listing, maxDepth = 3) {
  return listing
    .filter((item) => item.kind === 'file' && (item.path === 'index.ts' || item.path.endsWith('/index.ts')))
    .map((item) => item.path.slice(0, -'index.ts'.length).replace(/\/$/, ''))
    .filter((dir) => {
      const segments = dir ? dir.split('/') : [];
      return (
        segments.length <= maxDepth &&
        !segments.some((segment) => segment === 'node_modules' || segment.startsWith('.') || segment === 'test' || segment === 'tests')
      );
    })
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
}
