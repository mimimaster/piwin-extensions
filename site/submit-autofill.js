// Repository URL → suggested form values, from GitHub's public API.
import { fetchHeadCommit, fetchRepository, parseRepositoryInput } from './github-api.js';
import { inspectSource } from './source-inspect.js';
import { latestInstallable } from './search.js';

const IGNORED_TOPICS = new Set(['pi-package', 'pi-extension', 'piwin', 'piwin-extension']);

/**
 * @returns {Promise<{
 *   repo: object, commit: string, roots: string[], suggestions: Record<string, string>,
 *   forkBase?: object, alreadyListed?: object, source: object,
 * }>}
 */
export async function lookupRepository(input, extensions) {
  const parsed = parseRepositoryInput(input);
  if (!parsed) throw new Error('看不懂这个地址。请粘贴 https://github.com/<owner>/<repo>。');
  const repo = await fetchRepository(parsed.owner, parsed.repo);
  const commit = await fetchHeadCommit(parsed.owner, parsed.repo, repo.defaultBranch);
  const url = `https://github.com/${repo.fullName}`;

  // Pick the extension directory first, then inspect exactly that target.
  const probe = await inspectSource({ repository: url, commit, subdir: '' });
  const roots = probe.roots;
  const subdir = roots.includes('') ? '' : roots.length === 1 ? roots[0] : '';
  const source = subdir === '' ? probe : await inspectSource({ repository: url, commit, subdir });

  const suggestions = {
    repository: url,
    owner: repo.owner.toLowerCase(),
    slug: toSlug(subdir ? subdir.split('/').pop() : repo.name),
    name: toTitle(subdir ? subdir.split('/').pop() : repo.name),
    description: repo.description.slice(0, 500),
    license: repo.license,
    homepage: repo.homepage,
    keywords: repo.topics.filter((topic) => !IGNORED_TOPICS.has(topic)).slice(0, 20).join(', '),
    subdir,
    commit,
    version: source.packageVersion ?? '',
  };

  const forkBase = repo.parent
    ? extensions.find((entry) => entry.repository.toLowerCase() === `https://github.com/${repo.parent}`.toLowerCase())
    : undefined;
  if (forkBase) {
    suggestions.forkId = forkBase.id;
    suggestions.forkVersion = latestInstallable(forkBase)?.version ?? forkBase.versions[0].version;
  }
  const alreadyListed = extensions.find((entry) => entry.repository.toLowerCase() === url.toLowerCase());
  return { repo, commit, roots, suggestions, forkBase, alreadyListed, source };
}

export function toSlug(value) {
  return value
    .toLowerCase()
    .replace(/\.ts$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
}

export function toTitle(value) {
  return value
    .replace(/\.ts$/, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .slice(0, 80);
}
