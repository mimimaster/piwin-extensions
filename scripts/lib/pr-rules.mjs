// Pull request rules: which entries changed, who may change them, and what
// may change. Pure over the base entries and the PR's changed files, so the
// same code runs in CI (files read through the GitHub API) and in tests.
import { MODIFIABLE_LICENSES, isCopyleft, isFormattedEntry, parseEntryPath, validateEntry } from './entry.mjs';
import { isRegistryMetaFile } from './registry-tree.mjs';

/**
 * @param {object} input
 * @param {Map<string, {path, raw, entry?, parseError?, owner, name, id}>} input.baseEntries
 *   readEntries(base checkout).entries
 * @param {Array<{ path: string, content: string | null }>} input.changes
 *   every file the PR touches; `content: null` means removed
 * @param {string} input.author  PR author login
 * @param {(org: string, user: string) => Promise<boolean>} input.isPublicOrgMember
 * @returns {Promise<{
 *   problems: string[],
 *   checkedIds: string[],
 *   versionsToCheck: Array<{ id, version, commit, repository, subdir }>,
 *   forkLinks: Array<{ id, original: { id, version, url }, modified: { version, url } }>,
 * }>}
 */
export async function checkPullRequest(input) {
  const author = input.author.toLowerCase();
  const problems = [];
  const versionsToCheck = [];
  const forkLinks = [];
  const headEntries = new Map(input.baseEntries);
  const changedIds = new Set();

  for (const change of input.changes) {
    if (!change.path.startsWith('extensions/')) {
      problems.push(`${change.path}: only extensions/<owner>/<name>.json may change in a submission PR`);
      continue;
    }
    const parsedPath = parseEntryPath(change.path);
    if (!parsedPath || isRegistryMetaFile(change.path)) {
      problems.push(`${change.path}: files under extensions/ must be named extensions/<owner>/<name>.json`);
      continue;
    }
    changedIds.add(parsedPath.id);
    if (change.content === null) {
      headEntries.delete(parsedPath.id);
      continue;
    }
    try {
      headEntries.set(parsedPath.id, { ...parsedPath, path: change.path, raw: change.content, entry: JSON.parse(change.content) });
    } catch (error) {
      headEntries.set(parsedPath.id, { ...parsedPath, path: change.path, raw: change.content, parseError: String(error) });
    }
  }

  for (const id of [...changedIds].sort()) {
    const before = input.baseEntries.get(id);
    const after = headEntries.get(id);
    const at = `extensions/${id}.json`;

    if (!after) {
      problems.push(`${at}: entries cannot be removed by a PR; yank its versions instead`);
      continue;
    }
    if (after.parseError) {
      problems.push(`${at}: invalid JSON (${after.parseError})`);
      continue;
    }
    for (const problem of validateEntry(after.entry, id)) problems.push(`${at}: ${problem}`);
    if (!isFormattedEntry(after.raw, after.entry)) {
      problems.push(`${at}: format as 2-space JSON with a trailing newline (npm run format)`);
    }

    if (!before) {
      if (after.owner !== author && !(await input.isPublicOrgMember(after.owner, author))) {
        problems.push(
          `${at}: new entries go under your own handle (extensions/${author}/…) or an organization you are a public member of`,
        );
      }
      if (!Array.isArray(after.entry.owners) || !after.entry.owners.includes(author)) {
        problems.push(`${at}: add yourself ("${author}") to owners`);
      }
    } else if (before.parseError) {
      problems.push(`${at}: the published entry is unreadable; ask a maintainer`);
    } else {
      if (!before.entry.owners.includes(author)) {
        problems.push(`${at}: only its owners (${before.entry.owners.join(', ')}) may change this entry`);
      }
      problems.push(...checkVersionHistory(at, before.entry, after.entry));
    }

    const fork = checkFork(at, after.entry, headEntries);
    problems.push(...fork.problems);
    if (fork.link) forkLinks.push({ id, ...fork.link });

    const published = new Set((before?.entry?.versions ?? []).map((version) => version.version));
    for (const version of Array.isArray(after.entry.versions) ? after.entry.versions : []) {
      if (published.has(version.version) || typeof version.commit !== 'string') continue;
      versionsToCheck.push({
        id,
        version: version.version,
        commit: version.commit,
        repository: after.entry.repository,
        subdir: after.entry.subdir,
      });
    }
  }
  return { problems, checkedIds: [...changedIds].sort(), versionsToCheck, forkLinks };
}

/**
 * Append-only history: every published version stays with the same commit and
 * publishedAt. The only edit is adding `yanked`, which cannot be undone.
 */
export function checkVersionHistory(at, before, after) {
  const problems = [];
  const byVersion = new Map(
    (Array.isArray(after.versions) ? after.versions : []).map((version) => [version.version, version]),
  );
  for (const published of before.versions ?? []) {
    const current = byVersion.get(published.version);
    if (!current) {
      problems.push(`${at}: version ${published.version} was removed; yank it instead`);
      continue;
    }
    if (current.commit !== published.commit) {
      problems.push(`${at}: version ${published.version} changed commit; publish a new version instead`);
    }
    if (current.publishedAt !== published.publishedAt) {
      problems.push(`${at}: version ${published.version} changed publishedAt`);
    }
    if (published.yanked && JSON.stringify(current.yanked) !== JSON.stringify(published.yanked)) {
      problems.push(`${at}: version ${published.version} is yanked; that cannot be undone or reworded`);
    }
  }
  if (before.repository !== after.repository) {
    problems.push(`${at}: repository cannot change; publish a new entry`);
  }
  return problems;
}

/** Fork base must exist with that version and a license that allows modification. */
export function checkFork(at, entry, entries) {
  if (!entry.forkOf || typeof entry.forkOf.id !== 'string') return { problems: [] };
  const base = entries.get(entry.forkOf.id);
  if (!base || base.parseError) {
    return { problems: [`${at}: forkOf ${entry.forkOf.id} is not in the registry`] };
  }
  const problems = [];
  const baseVersion = (base.entry.versions ?? []).find((version) => version.version === entry.forkOf.version);
  if (!baseVersion) {
    problems.push(`${at}: forkOf ${entry.forkOf.id} has no version ${entry.forkOf.version}`);
  }
  if (!MODIFIABLE_LICENSES.has(base.entry.license)) {
    problems.push(`${at}: ${entry.forkOf.id} is licensed "${base.entry.license}", which does not grant modification`);
  } else if (isCopyleft(base.entry.license) && entry.license !== base.entry.license) {
    problems.push(`${at}: a fork of a ${base.entry.license} extension must keep license ${base.entry.license}`);
  }
  const newest = Array.isArray(entry.versions) ? entry.versions[0] : undefined;
  const link =
    baseVersion && newest && typeof entry.repository === 'string'
      ? {
          original: {
            id: entry.forkOf.id,
            version: baseVersion.version,
            url: commitUrl(base.entry.repository, baseVersion.commit, base.entry.subdir),
          },
          modified: { version: newest.version, url: commitUrl(entry.repository, newest.commit, entry.subdir) },
        }
      : undefined;
  return link ? { problems, link } : { problems };
}

/** Browsable tree of a pinned commit (the subdir when there is one). */
export function commitUrl(repository, commit, subdir) {
  return subdir ? `${repository}/tree/${commit}/${subdir}` : `${repository}/commit/${commit}`;
}
