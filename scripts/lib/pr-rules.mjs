// Pull request rules: which entries changed, who may change them, and what
// may change. Pure over two parsed checkouts so it is unit-testable; GitHub
// and git access are injected.
import { MODIFIABLE_LICENSES, isCopyleft, validateEntry } from './entry.mjs';

/**
 * @param {object} input
 * @param {Map} input.base   readEntries(base).entries
 * @param {Map} input.head   readEntries(head).entries
 * @param {string[]} input.headStrayFiles
 * @param {string[]} input.changed  changedFiles(base, head)
 * @param {string} input.author  PR author login
 * @param {(org: string, user: string) => Promise<boolean>} input.isPublicOrgMember
 * @returns {Promise<{ problems: string[], versionsToCheck: Array<{ id, repository, subdir, commit, version }> }>}
 */
export async function checkPullRequest(input) {
  const author = input.author.toLowerCase();
  const problems = [];
  const versionsToCheck = [];

  for (const path of input.changed) {
    if (!path.startsWith('extensions/')) {
      problems.push(`${path}: only extensions/<owner>/<name>.json may change in a submission PR`);
    }
  }
  for (const path of input.headStrayFiles) {
    problems.push(`${path}: files under extensions/ must be named extensions/<owner>/<name>.json`);
  }

  const changedIds = new Set();
  for (const map of [input.base, input.head]) {
    for (const [id, item] of map) {
      if (input.changed.includes(item.path)) changedIds.add(id);
    }
  }

  for (const id of [...changedIds].sort()) {
    const before = input.base.get(id);
    const after = input.head.get(id);
    const at = `extensions/${id}.json`;

    if (!after) {
      if (!ownsEntry(before, author)) problems.push(`${at}: only an owner may remove this entry`);
      continue;
    }
    if (after.parseError) {
      problems.push(`${at}: invalid JSON (${after.parseError})`);
      continue;
    }
    for (const problem of validateEntry(after.entry)) problems.push(`${at}: ${problem}`);
    if (after.raw !== `${JSON.stringify(after.entry, null, 2)}\n`) {
      problems.push(`${at}: format with 2-space JSON and a trailing newline (run: npm run format)`);
    }

    if (!before) {
      const ownerIsAuthor = after.owner === author;
      if (!ownerIsAuthor && !(await input.isPublicOrgMember(after.owner, author))) {
        problems.push(
          `${at}: new entries live under your own handle (extensions/${author}/…) or an org you publicly belong to`,
        );
      }
      if (!Array.isArray(after.entry.owners) || !after.entry.owners.includes(author)) {
        problems.push(`${at}: add yourself ("${author}") to owners`);
      }
    } else if (!before.parseError && !ownsEntry(before, author)) {
      problems.push(`${at}: only its owners (${before.entry.owners.join(', ')}) may change this entry`);
    }

    if (before && !before.parseError) {
      problems.push(...checkVersionHistory(at, before.entry, after.entry));
    }
    problems.push(...checkFork(at, after.entry, input.head));

    const knownVersions = new Set((before?.entry?.versions ?? []).map((version) => version.version));
    for (const version of after.entry.versions ?? []) {
      if (knownVersions.has(version.version)) continue;
      versionsToCheck.push({
        id,
        version: version.version,
        commit: version.commit,
        repository: after.entry.repository,
        subdir: after.entry.subdir,
      });
    }
  }
  return { problems, versionsToCheck };
}

function ownsEntry(item, author) {
  return Boolean(item && !item.parseError && Array.isArray(item.entry.owners) && item.entry.owners.includes(author));
}

/** Published versions are immutable; new versions go on top; yank is the only edit. */
export function checkVersionHistory(at, before, after) {
  const problems = [];
  const afterVersions = Array.isArray(after.versions) ? after.versions : [];
  const byVersion = new Map(afterVersions.map((version) => [version.version, version]));
  for (const published of before.versions ?? []) {
    const current = byVersion.get(published.version);
    if (!current) {
      problems.push(`${at}: version ${published.version} was removed; yank it instead`);
    } else if (current.commit !== published.commit) {
      problems.push(`${at}: version ${published.version} changed commit; publish a new version instead`);
    } else if (published.yanked && !current.yanked) {
      problems.push(`${at}: version ${published.version} cannot be un-yanked; publish a new version`);
    }
  }
  const publishedCount = (before.versions ?? []).length;
  const tail = afterVersions.slice(afterVersions.length - publishedCount).map((version) => version.version);
  const expectedTail = (before.versions ?? []).map((version) => version.version);
  if (tail.join('\n') !== expectedTail.join('\n')) {
    problems.push(`${at}: add new versions at the top of "versions" (newest first) without reordering`);
  }
  if (before.repository !== after.repository) {
    problems.push(`${at}: repository cannot change; publish a new entry`);
  }
  return problems;
}

export function checkFork(at, entry, headEntries) {
  if (!entry.forkOf) return [];
  const base = headEntries.get(entry.forkOf.id);
  if (!base || base.parseError) return [`${at}: forkOf ${entry.forkOf.id} is not in the registry`];
  const problems = [];
  if (!(base.entry.versions ?? []).some((version) => version.version === entry.forkOf.version)) {
    problems.push(`${at}: forkOf ${entry.forkOf.id} has no version ${entry.forkOf.version}`);
  }
  if (!MODIFIABLE_LICENSES.has(base.entry.license)) {
    problems.push(`${at}: ${entry.forkOf.id} is licensed "${base.entry.license}", which does not grant modification`);
  } else if (isCopyleft(base.entry.license) && entry.license !== base.entry.license) {
    problems.push(`${at}: a fork of a ${base.entry.license} extension must keep license ${base.entry.license}`);
  }
  return problems;
}
