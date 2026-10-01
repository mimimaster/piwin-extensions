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
  const hasIndexModule = inside.some((item) => item.path === `${prefix}index.ts` && item.kind === 'file');
  const manifestPath = `${prefix}piwin.json`;
  const hasManifest = inside.some((item) => item.path === manifestPath && item.kind === 'file');
  // A tool extension needs index.ts. A backend extension may omit it when
  // piwin.json declares sessionBackend; the text check decides if that
  // declaration is actually valid.
  if (!hasIndexModule && !hasManifest) {
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
    manifestPath: hasManifest ? manifestPath : null,
    requiresBackend: !hasIndexModule,
    kind: 'dir',
  };
}

const BACKEND_KEYS = new Set([
  'schemaVersion', 'id', 'name', 'version', 'minHostVersion', 'protocol', 'protocolVersion',
  'minHostProtocolVersion', 'platforms', 'verifiedCliVersions', 'helpUrl', 'artifact',
  'compatibleRevisions', 'unversionedBindingCompatible', 'outputDirectories',
]);
const ARTIFACT_KEYS = new Set(['format', 'entrypoint', 'sha256', 'byteSize']);
const PLATFORMS = new Set(['darwin', 'linux', 'win32']);

/**
 * Read piwin.json text. A missing sessionBackend is not an error here;
 * the caller requires one only when the tree has no index.ts.
 * @param {string} raw
 * @returns {{ problems: string[], entrypoint: string | null }}
 */
export function readSessionBackend(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { problems: ['piwin.json is not valid JSON'], entrypoint: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.hasOwn(parsed, 'sessionBackend')) {
    return { problems: [], entrypoint: null };
  }
  const value = parsed.sessionBackend;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { problems: ['sessionBackend must be an object'], entrypoint: null };
  }
  const problems = [];
  for (const key of Object.keys(value)) {
    if (!BACKEND_KEYS.has(key)) problems.push(`sessionBackend has unknown key "${key}"`);
  }
  if (value.schemaVersion !== 1) problems.push('sessionBackend schemaVersion must be 1');
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id) || value.id === 'pi') {
    problems.push('sessionBackend id is missing, reserved, or not a safe slug');
  }
  if (value.protocol !== 'piwin-agent-stdio' || value.protocolVersion !== 1) {
    problems.push('sessionBackend protocol is not piwin-agent-stdio v1');
  }
  if (typeof value.minHostProtocolVersion !== 'number' || value.minHostProtocolVersion > 1) {
    problems.push('sessionBackend requires a newer host protocol');
  }
  if (!Array.isArray(value.platforms) || value.platforms.length === 0 || value.platforms.some((item) => !PLATFORMS.has(item))) {
    problems.push('sessionBackend platforms are missing or unverified');
  }
  const artifact = value.artifact;
  let entrypoint = null;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    problems.push('sessionBackend artifact is missing');
  } else {
    for (const key of Object.keys(artifact)) {
      if (!ARTIFACT_KEYS.has(key)) problems.push(`sessionBackend artifact has unknown key "${key}"`);
    }
    if (artifact.format !== 'node-esm') problems.push('sessionBackend artifact must be node-esm');
    if (!isSafeArtifactPath(artifact.entrypoint)) {
      problems.push('sessionBackend artifact entrypoint escapes the extension or is not a .mjs file');
    } else {
      entrypoint = artifact.entrypoint;
    }
    if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
      problems.push('sessionBackend artifact sha256 is not 64 hex characters');
    }
    if (!Number.isSafeInteger(artifact.byteSize) || artifact.byteSize < 1) {
      problems.push('sessionBackend artifact byteSize is missing');
    }
  }
  if (!Array.isArray(value.outputDirectories)) problems.push('sessionBackend outputDirectories are missing');
  return { problems, entrypoint };
}

function isSafeArtifactPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\')) return false;
  if (!value.endsWith('.mjs')) return false;
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
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
    .filter((item) => item.kind === 'file' && (
      item.path === 'index.ts' || item.path.endsWith('/index.ts') ||
      item.path === 'piwin.json' || item.path.endsWith('/piwin.json')
    ))
    .map((item) => item.path.replace(/\/(index\.ts|piwin\.json)$/, '').replace(/^(index\.ts|piwin\.json)$/, ''))
    .filter((dir) => {
      const segments = dir ? dir.split('/') : [];
      return (
        segments.length <= maxDepth &&
        !segments.some((segment) => segment === 'node_modules' || segment.startsWith('.') || segment === 'test' || segment === 'tests')
      );
    })
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
}
