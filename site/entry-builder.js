// Build entry files in the browser with the CI's own rule module
// (scripts/lib/entry.mjs, published as ./lib/entry.mjs).
import { formatEntry, parseEntryPath, validateEntry } from './lib/entry.mjs';
import { BRANCH, MAX_PREFILL_URL_LENGTH } from './config.js';

const KEY_ORDER = [
  'name',
  'description',
  'owners',
  'repository',
  'subdir',
  'license',
  'keywords',
  'homepage',
  'forkOf',
  'versions',
];

/** Stable key order and no empty optional fields, so diffs stay small. */
export function canonicalEntry(entry) {
  const ordered = {};
  for (const key of KEY_ORDER) {
    const value = entry[key];
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0 && key === 'keywords')) {
      continue;
    }
    ordered[key] = value;
  }
  return ordered;
}

/** The entry file as it sits in the repository (the index adds `id`). */
export function entryFromIndex(indexEntry) {
  const { id: _id, ...entry } = indexEntry;
  return canonicalEntry(entry);
}

const splitList = (value) =>
  value
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * @param {Record<string, string>} form  raw field values
 * @param {Array} extensions  current index entries
 */
export function buildSubmission(form, extensions) {
  const owner = form.owner.trim().toLowerCase();
  const name = form.slug.trim().toLowerCase();
  const id = `${owner}/${name}`;
  const problems = [];
  if (!parseEntryPath(`extensions/${owner}/${name}.json`)) {
    problems.push('发布到 / 扩展标识：只能用小写字母、数字和 -（GitHub 用户名规则）');
  }
  const owners = [...new Set([owner, ...splitList(form.extraOwners.toLowerCase())])].filter(Boolean);
  const version = { version: form.version.trim(), commit: form.commit.trim().toLowerCase() };
  if (form.stampDate) version.publishedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const entry = canonicalEntry({
    name: form.name.trim(),
    description: form.description.trim(),
    owners,
    repository: form.repository.trim().replace(/\/+$/, ''),
    subdir: form.subdir.trim(),
    license: form.license.trim(),
    keywords: splitList(form.keywords),
    homepage: form.homepage.trim(),
    forkOf: form.forkId ? { id: form.forkId, version: form.forkVersion } : undefined,
    versions: [version],
  });
  problems.push(...validateEntry(entry, id));
  if (extensions.some((existing) => existing.id === id)) {
    problems.push(`${id} 已存在；要发新版本请到它的详情页`);
  }
  if (entry.forkOf) {
    const base = extensions.find((existing) => existing.id === entry.forkOf.id);
    if (!base) problems.push(`改装来源 ${entry.forkOf.id} 不在仓库里`);
    else if (!base.versions.some((item) => item.version === entry.forkOf.version)) {
      problems.push(`改装来源 ${entry.forkOf.id} 没有版本 ${entry.forkOf.version}`);
    }
  }
  return { id, owner, name, entry, problems, text: formatEntry(entry) };
}

/** New version on top and/or a yank; everything published stays as it was. */
export function buildUpdate(indexEntry, change) {
  const entry = entryFromIndex(indexEntry);
  const versions = entry.versions.map((version) => ({ ...version }));
  const problems = [];
  let changed = false;
  if (change.version.trim() || change.commit.trim()) {
    const version = { version: change.version.trim(), commit: change.commit.trim().toLowerCase() };
    if (change.stampDate) version.publishedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    versions.unshift(version);
    changed = true;
  }
  if (change.yankVersion) {
    const target = versions.find((version) => version.version === change.yankVersion);
    if (!target) problems.push(`没有版本 ${change.yankVersion}`);
    else if (target.yanked) problems.push(`${change.yankVersion} 已经撤回`);
    else if (!change.yankReason.trim()) problems.push('撤回需要写原因');
    else {
      target.yanked = { reason: change.yankReason.trim() };
      changed = true;
    }
  }
  if (!changed && problems.length === 0) problems.push('填写新版本，或选择要撤回的版本');
  const updated = { ...entry, versions };
  problems.push(...validateEntry(updated, indexEntry.id));
  return { entry: updated, problems, text: formatEntry(updated) };
}

/**
 * GitHub's new-file page, prefilled. A non-collaborator gets GitHub's own
 * fork-and-PR flow, so the PR author is the submitter. Returns null when the
 * URL would be too long; callers then copy the JSON and open `emptyUrl`.
 */
export function newFileLinks(repo, owner, name, text) {
  const base = `https://github.com/${repo}/new/${BRANCH}/extensions/${encodeURIComponent(owner)}`;
  const emptyUrl = `${base}?filename=${encodeURIComponent(`${name}.json`)}`;
  const prefilledUrl = `${emptyUrl}&value=${encodeURIComponent(text)}`;
  return {
    emptyUrl,
    prefilledUrl: prefilledUrl.length <= MAX_PREFILL_URL_LENGTH ? prefilledUrl : null,
    length: prefilledUrl.length,
  };
}

export function editFileUrl(repo, id) {
  return `https://github.com/${repo}/edit/${BRANCH}/extensions/${id}.json`;
}

export function commitUrl(entry, commit) {
  return entry.subdir
    ? `${entry.repository}/tree/${commit}/${entry.subdir}`
    : `${entry.repository}/commit/${commit}`;
}
