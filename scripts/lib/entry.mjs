// Strict validation of one registry entry file: extensions/<owner>/<name>.json.
//
// One module, three users: the PR check (scripts/validate-pr.mjs), the
// single-file check (scripts/validate-entry.mjs), and the web front end, which
// imports this file as-is (no Node APIs here). Every rule piwin's client parser
// (@piwin/marketplace parse-registry-index.ts) enforces is enforced here too;
// this side is stricter about form (unknown keys, lowercase, no `.git`).

export const OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
export const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
export const REPOSITORY_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const ENTRY_PATH_PATTERN = /^extensions\/([^/]+)\/([^/]+)\.json$/;

const ENTRY_KEYS = new Set([
  '$schema',
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
]);
const VERSION_KEYS = new Set(['version', 'commit', 'publishedAt', 'yanked']);

/** OSI licenses that permit modification; forks may only be based on these. */
export const MODIFIABLE_LICENSES = new Set([
  '0BSD',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'ISC',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MIT',
  'MPL-2.0',
  'Unlicense',
]);

/** Copyleft bases whose forks must keep the same license. */
const COPYLEFT_PREFIXES = ['AGPL-', 'GPL-', 'LGPL-', 'MPL-'];

export function isCopyleft(license) {
  return COPYLEFT_PREFIXES.some((prefix) => license.startsWith(prefix));
}

/** Canonical file text CI expects: 2-space JSON with a trailing newline. */
export function formatEntry(entry) {
  return `${JSON.stringify(entry, null, 2)}\n`;
}

/**
 * Whether `raw` is the canonical text up to line endings. GitHub's web editor
 * may drop the final newline or use CRLF; neither should fail a submission.
 */
export function isFormattedEntry(raw, entry) {
  return `${raw.replace(/\r\n/g, '\n').trimEnd()}\n` === formatEntry(entry);
}

/** `extensions/alice/tool.json` → { owner: 'alice', name: 'tool', id: 'alice/tool' } or null. */
export function parseEntryPath(relativePath) {
  const match = ENTRY_PATH_PATTERN.exec(relativePath);
  if (!match) return null;
  const [, owner, name] = match;
  if (!OWNER_PATTERN.test(owner) || !NAME_PATTERN.test(name)) return null;
  return { owner, name, id: `${owner}/${name}` };
}

/**
 * Returns a list of problems; empty means valid.
 * @param {unknown} entry  parsed entry file
 * @param {string} [id]    `<owner>/<name>` from the path, for the self-fork rule
 */
export function validateEntry(entry, id) {
  const problems = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return ['entry must be a JSON object'];
  }
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.has(key)) problems.push(`unknown key "${key}"`);
  }
  requireText(entry.name, 'name', 80, problems);
  if (entry.description !== undefined) requireText(entry.description, 'description', 500, problems);
  if (!Array.isArray(entry.owners) || entry.owners.length === 0) {
    problems.push('owners must be a non-empty array of GitHub handles');
  } else {
    for (const owner of entry.owners) {
      if (typeof owner !== 'string' || owner !== owner.toLowerCase() || !OWNER_PATTERN.test(owner)) {
        problems.push(`owner ${JSON.stringify(owner)} must be a lowercase GitHub handle`);
      }
    }
  }
  if (
    typeof entry.repository !== 'string' ||
    !REPOSITORY_PATTERN.test(entry.repository) ||
    entry.repository.toLowerCase().endsWith('.git')
  ) {
    problems.push('repository must be https://github.com/<owner>/<repo> without .git or trailing slash');
  }
  if (entry.subdir !== undefined) {
    const subdir = entry.subdir;
    const invalid =
      typeof subdir !== 'string' ||
      !subdir ||
      subdir.startsWith('/') ||
      subdir.includes('\\') ||
      subdir.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
    if (invalid) problems.push('subdir must be a relative path inside the repository (no ./, .., or trailing /)');
  }
  requireText(entry.license, 'license', 64, problems);
  if (entry.keywords !== undefined) {
    if (!Array.isArray(entry.keywords) || entry.keywords.length > 20) {
      problems.push('keywords must be an array of at most 20 strings');
    } else {
      for (const keyword of entry.keywords) requireText(keyword, 'keyword', 40, problems);
    }
  }
  if (entry.homepage !== undefined && (typeof entry.homepage !== 'string' || !entry.homepage.startsWith('https://'))) {
    problems.push('homepage must be an https URL');
  }
  if (entry.forkOf !== undefined) {
    const fork = entry.forkOf;
    const valid =
      fork &&
      typeof fork === 'object' &&
      Object.keys(fork).every((key) => key === 'id' || key === 'version') &&
      typeof fork.id === 'string' &&
      parseEntryPath(`extensions/${fork.id}.json`) !== null &&
      typeof fork.version === 'string' &&
      VERSION_PATTERN.test(fork.version);
    if (!valid) problems.push('forkOf must be { "id": "<owner>/<name>", "version": "<version>" }');
    else if (id !== undefined && fork.id === id) problems.push('forkOf cannot name the entry itself');
  }
  if (!Array.isArray(entry.versions) || entry.versions.length === 0) {
    problems.push('versions must be a non-empty array, newest first');
  } else {
    const seen = new Set();
    entry.versions.forEach((version, index) => {
      const at = `versions[${index}]`;
      if (!version || typeof version !== 'object' || Array.isArray(version)) {
        problems.push(`${at} must be an object`);
        return;
      }
      for (const key of Object.keys(version)) {
        if (!VERSION_KEYS.has(key)) problems.push(`${at}: unknown key "${key}"`);
      }
      if (typeof version.version !== 'string' || !VERSION_PATTERN.test(version.version)) {
        problems.push(`${at}.version is invalid`);
      } else if (seen.has(version.version)) {
        problems.push(`${at}: duplicate version ${version.version}`);
      } else {
        seen.add(version.version);
      }
      if (typeof version.commit !== 'string' || !COMMIT_PATTERN.test(version.commit)) {
        problems.push(`${at}.commit must be a full lowercase 40-hex commit SHA (tags and branches move)`);
      }
      if (version.publishedAt !== undefined && Number.isNaN(Date.parse(version.publishedAt))) {
        problems.push(`${at}.publishedAt must be an ISO date`);
      }
      if (version.yanked !== undefined) {
        const yanked = version.yanked;
        if (!yanked || typeof yanked !== 'object' || typeof yanked.reason !== 'string' || !yanked.reason.trim()) {
          problems.push(`${at}.yanked must be { "reason": "<why>" }`);
        }
      }
    });
  }
  return problems;
}

function requireText(value, field, maxLength, problems) {
  if (typeof value !== 'string' || !value.trim()) {
    problems.push(`${field} must be a non-empty string`);
  } else if (value.length > maxLength) {
    problems.push(`${field} must be at most ${maxLength} characters`);
  }
}
