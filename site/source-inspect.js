// Pre-PR source check in the browser: the same rules the CI applies
// (./lib/source-rules.mjs), fed from GitHub's tree API instead of a checkout.
import { checkPackageJsonText, checkSourceListing, findExtensionRoots } from './lib/source-rules.mjs';
import { fetchListing, fetchRawText, parseRepositoryInput } from './github-api.js';

/**
 * @returns {Promise<{
 *   problems: string[],   // CI-equivalent source problems
 *   truncated: boolean,   // GitHub cut the listing; counts and sizes are partial
 *   roots: string[],      // directories that contain index.ts ('' = root)
 *   packageVersion?: string,
 * }>}
 */
export async function inspectSource({ repository, commit, subdir }) {
  const parsed = parseRepositoryInput(repository);
  if (!parsed) return { problems: ['repository must be https://github.com/<owner>/<repo>'], truncated: false, roots: [] };
  const tree = await fetchListing(parsed.owner, parsed.repo, commit);
  if (!tree) {
    return { problems: [`commit ${commit.slice(0, 12)} is not in ${parsed.owner}/${parsed.repo}; push it first`], truncated: false, roots: [] };
  }
  const result = checkSourceListing(tree.listing, subdir || undefined);
  const problems = [...result.problems];
  const packageJsonPath = result.packageJsonPath ?? packageJsonFor(tree.listing, subdir);
  let packageVersion;
  if (packageJsonPath) {
    const raw = await fetchRawText(parsed.owner, parsed.repo, commit, packageJsonPath);
    if (raw !== null) {
      if (result.packageJsonPath) problems.push(...checkPackageJsonText(raw));
      packageVersion = readVersion(raw);
    }
  }
  return {
    problems,
    truncated: tree.truncated,
    roots: findExtensionRoots(tree.listing),
    kind: result.kind,
    ...(packageVersion ? { packageVersion } : {}),
  };
}

/** A single-file extension may still carry its version in the repo's package.json. */
function packageJsonFor(listing, subdir) {
  const directory = subdir && subdir.endsWith('.ts') ? subdir.split('/').slice(0, -1).join('/') : subdir ?? '';
  for (const candidate of [directory ? `${directory}/package.json` : 'package.json', 'package.json']) {
    if (listing.some((item) => item.path === candidate && item.kind === 'file')) return candidate;
  }
  return null;
}

function readVersion(raw) {
  try {
    const version = JSON.parse(raw)?.version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}
