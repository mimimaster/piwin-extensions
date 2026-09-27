import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildIndex } from './lib/build-index.mjs';
import { formatEntry, parseEntryPath, validateEntry } from './lib/entry.mjs';
import { checkPullRequest } from './lib/pr-rules.mjs';
import { readEntries, listFiles } from './lib/registry-tree.mjs';
import { renderReport } from './lib/report.mjs';
import { checkPinnedSource, checkTree } from './lib/source-check.mjs';
import { compareVersions, sortVersionsNewestFirst } from './lib/versions.mjs';

const run = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(repoRoot, 'schema/fixtures');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function entry(overrides = {}) {
  return {
    name: 'Git Autopilot',
    description: 'Commits with generated messages.',
    owners: ['alice'],
    repository: 'https://github.com/alice/git-autopilot',
    license: 'MIT',
    versions: [{ version: '1.0.0', commit: A }],
    ...overrides,
  };
}

async function tree(files) {
  const root = await mkdtemp(join(tmpdir(), 'registry-tree-'));
  for (const [path, value] of Object.entries(files)) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), typeof value === 'string' ? value : formatEntry(value));
  }
  return root;
}

/** Base checkout on disk; PR changes as the API would deliver them. */
async function prCheck(baseFiles, changes, author) {
  const { entries } = await readEntries(await tree(baseFiles));
  return checkPullRequest({
    baseEntries: entries,
    changes: Object.entries(changes).map(([path, value]) => ({
      path,
      content: value === null ? null : typeof value === 'string' ? value : formatEntry(value),
    })),
    author,
    isPublicOrgMember: async (org, user) => org === 'acme' && user === 'bob',
  });
}

describe('fixtures', async () => {
  const expectations = JSON.parse(await readFile(join(fixtures, 'expectations.json'), 'utf8'));
  const files = (await listFiles(fixtures)).filter((path) => path.endsWith('.json') && path !== 'expectations.json');

  for (const path of files) {
    it(path, async () => {
      const parsedPath = parseEntryPath(path.split('/').slice(-3).join('/'));
      const raw = await readFile(join(fixtures, path), 'utf8');
      const problems = parsedPath
        ? validateEntry(JSON.parse(raw), parsedPath.id)
        : ['path: invalid <owner>/<name>'];
      if (path.startsWith('valid/')) {
        assert.deepEqual(problems, []);
        assert.equal(raw, formatEntry(JSON.parse(raw)), 'fixture is formatted');
      } else {
        const expected = expectations[path];
        assert.ok(expected, `${path} needs an expectations.json reason`);
        assert.ok(
          problems.some((problem) => problem.includes(expected)),
          `${path}: expected a "${expected}" problem, got ${JSON.stringify(problems)}`,
        );
      }
    });
  }

  it('builds an index from the valid fixtures with versions newest first', async () => {
    const { index, problems } = await buildIndex(join(fixtures, 'valid'), new Date('2026-09-27T00:00:00Z'));
    assert.deepEqual(problems, []);
    assert.deepEqual(
      index.extensions.map((item) => item.id),
      ['acme/minimal', 'alice/git-autopilot', 'yorick/git-autopilot'],
    );
    assert.deepEqual(
      index.extensions[1].versions.map((version) => version.version),
      ['1.2.0', '1.1.0'],
    );
  });

  it('refuses to build an index that contains an invalid entry', async () => {
    const { problems } = await buildIndex(join(fixtures, 'invalid'));
    assert.ok(problems.length > 0);
  });
});

describe('versions', () => {
  it('orders by semver precedence and keeps non-semver in file order', () => {
    assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
    assert.ok(compareVersions('1.0.0', '1.0.0-rc.1') > 0);
    assert.ok(compareVersions('1.0.0-rc.10', '1.0.0-rc.2') > 0);
    assert.deepEqual(
      sortVersionsNewestFirst([
        { version: '0.9.0' },
        { version: '1.0.0-zh.1' },
        { version: 'nightly' },
        { version: '1.0.0' },
      ]).map((version) => version.version),
      ['1.0.0', '1.0.0-zh.1', '0.9.0', 'nightly'],
    );
  });
});

describe('pull request rules', () => {
  it('lets a user add an entry under their own handle', async () => {
    const result = await prCheck({}, { 'extensions/alice/git-autopilot.json': entry() }, 'alice');
    assert.deepEqual(result.problems, []);
    assert.equal(result.versionsToCheck.length, 1);
  });

  it('allows public org members and rejects squatting another handle', async () => {
    const org = await prCheck({}, { 'extensions/acme/tool.json': entry({ owners: ['bob'] }) }, 'bob');
    assert.deepEqual(org.problems, []);
    const squat = await prCheck({}, { 'extensions/alice/tool.json': entry({ owners: ['mallory'] }) }, 'mallory');
    assert.ok(squat.problems.some((problem) => problem.includes('your own handle')));
  });

  it('only owners may edit; history is append-only with yank as the only edit', async () => {
    const base = { 'extensions/alice/git-autopilot.json': entry() };
    const stranger = await prCheck(
      base,
      { 'extensions/alice/git-autopilot.json': entry({ description: 'hijacked' }) },
      'mallory',
    );
    assert.ok(stranger.problems.some((problem) => problem.includes('only its owners')));

    const rewritten = await prCheck(
      base,
      { 'extensions/alice/git-autopilot.json': entry({ versions: [{ version: '1.0.0', commit: B }] }) },
      'alice',
    );
    assert.ok(rewritten.problems.some((problem) => problem.includes('changed commit')));

    const removed = await prCheck(base, { 'extensions/alice/git-autopilot.json': null }, 'alice');
    assert.ok(removed.problems.some((problem) => problem.includes('cannot be removed')));

    const bumped = await prCheck(
      base,
      {
        'extensions/alice/git-autopilot.json': entry({
          versions: [
            { version: '1.0.0', commit: A, yanked: { reason: 'data loss on rebase' } },
            { version: '1.1.0', commit: B },
          ],
        }),
      },
      'alice',
    );
    assert.deepEqual(bumped.problems, []);
    assert.deepEqual(
      bumped.versionsToCheck.map((version) => version.version),
      ['1.1.0'],
    );

    const yankedBase = {
      'extensions/alice/git-autopilot.json': entry({ versions: [{ version: '1.0.0', commit: A, yanked: { reason: 'x' } }] }),
    };
    const unyanked = await prCheck(yankedBase, { 'extensions/alice/git-autopilot.json': entry() }, 'alice');
    assert.ok(unyanked.problems.some((problem) => problem.includes('cannot be undone')));
  });

  it('checks fork bases, copyleft licenses, and links both commits', async () => {
    const base = {
      'extensions/alice/git-autopilot.json': entry({ license: 'GPL-3.0-only', subdir: 'extension' }),
    };
    const fork = (license, version = '1.0.0') => ({
      'extensions/yorick/git-autopilot.json': entry({
        owners: ['yorick'],
        repository: 'https://github.com/yorick/git-autopilot',
        license,
        forkOf: { id: 'alice/git-autopilot', version },
        versions: [{ version: '1.0.0-zh.1', commit: B }],
      }),
    });
    const ok = await prCheck(base, fork('GPL-3.0-only'), 'yorick');
    assert.deepEqual(ok.problems, []);
    assert.deepEqual(ok.forkLinks, [
      {
        id: 'yorick/git-autopilot',
        original: {
          id: 'alice/git-autopilot',
          version: '1.0.0',
          url: `https://github.com/alice/git-autopilot/tree/${A}/extension`,
        },
        modified: { version: '1.0.0-zh.1', url: `https://github.com/yorick/git-autopilot/commit/${B}` },
      },
    ]);
    const report = renderReport(ok);
    assert.ok(report.includes(ok.forkLinks[0].original.url) && report.includes(ok.forkLinks[0].modified.url));

    const relicensed = await prCheck(base, fork('MIT'), 'yorick');
    assert.ok(relicensed.problems.some((problem) => problem.includes('must keep license')));
    const missing = await prCheck(base, fork('GPL-3.0-only', '9.9.9'), 'yorick');
    assert.ok(missing.problems.some((problem) => problem.includes('no version 9.9.9')));
  });

  it('rejects edits outside extensions/, meta files, and unformatted JSON', async () => {
    const result = await prCheck(
      {},
      {
        '.github/workflows/validate.yml': 'on: push',
        'extensions/_examples/alice/hello-piwin.json': entry(),
        'extensions/alice/git-autopilot.json': JSON.stringify(entry()),
      },
      'alice',
    );
    assert.ok(result.problems.some((problem) => problem.startsWith('.github/workflows/validate.yml')));
    assert.ok(result.problems.some((problem) => problem.startsWith('extensions/_examples/')));
    assert.ok(result.problems.some((problem) => problem.includes('2-space JSON')));
  });

  it('accepts what GitHub\'s web editor saves: CRLF or no final newline', async () => {
    const text = formatEntry(entry()).trimEnd();
    for (const raw of [text, text.replace(/\n/g, '\r\n')]) {
      const result = await prCheck({}, { 'extensions/alice/git-autopilot.json': raw }, 'alice');
      assert.deepEqual(result.problems, []);
    }
  });
});

describe('source checks', () => {
  it('requires index.ts and forbids dependencies, install scripts and symlinks', async () => {
    const good = await tree({ 'ext/index.ts': 'export default () => {};\n' });
    assert.deepEqual(await checkTree(good, 'ext'), []);
    const bad = await tree({
      'ext/main.ts': 'x',
      'ext/package.json': { dependencies: { lodash: '^4' }, scripts: { postinstall: 'curl evil' } },
    });
    await symlink('/etc/passwd', join(bad, 'ext', 'link'));
    const problems = await checkTree(bad, 'ext');
    assert.ok(problems.some((problem) => problem.includes('no index.ts')));
    assert.ok(problems.some((problem) => problem.includes('dependencies')));
    assert.ok(problems.some((problem) => problem.includes('"postinstall"')));
    assert.ok(problems.some((problem) => problem.includes('symbolic link')));
  });

  it('accepts a subdir that names a single .ts file', async () => {
    const root = await tree({ 'extensions/tool.ts': 'export default () => {};\n', 'README.md': '#' });
    assert.deepEqual(await checkTree(root, 'extensions/tool.ts'), []);
    assert.ok((await checkTree(root, 'README.md')).some((problem) => problem.includes('.ts module')));
  });

  it('fetches exactly the pinned commit', async () => {
    const repo = await tree({ 'index.ts': 'export const v = 1;\n' });
    const git = (...args) => run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo });
    await git('init', '-q');
    await git('commit', '-q', '--allow-empty', '-m', 'empty');
    const empty = (await git('rev-parse', 'HEAD')).stdout.trim();
    await git('add', '.');
    await git('commit', '-q', '-m', 'v1');
    const withIndex = (await git('rev-parse', 'HEAD')).stdout.trim();

    assert.deepEqual(await checkPinnedSource({ repository: repo, commit: withIndex }), []);
    const problems = await checkPinnedSource({ repository: repo, commit: empty });
    assert.ok(problems.some((problem) => problem.includes('no index.ts')));
  });
});

describe('source rules on a listing (what the web front end checks)', async () => {
  const { checkPackageJsonText, checkSourceListing, findExtensionRoots } = await import('./lib/source-rules.mjs');
  const listing = [
    { path: 'README.md', kind: 'file', size: 10 },
    { path: 'extension', kind: 'dir' },
    { path: 'extension/index.ts', kind: 'file', size: 100 },
    { path: 'extension/package.json', kind: 'file', size: 50 },
    { path: 'extension/link', kind: 'symlink' },
    { path: 'tools', kind: 'dir' },
    { path: 'tools/single.ts', kind: 'file', size: 30 },
    { path: 'test', kind: 'dir' },
    { path: 'test/index.ts', kind: 'file', size: 1 },
  ];

  it('checks directory and single-file targets', () => {
    const dir = checkSourceListing(listing, 'extension');
    assert.equal(dir.packageJsonPath, 'extension/package.json');
    assert.deepEqual(dir.problems, ['symbolic link not allowed: link']);
    assert.deepEqual(checkSourceListing(listing, 'tools/single.ts').problems, []);
    assert.ok(checkSourceListing(listing, 'missing').problems[0].includes('does not exist'));
    assert.ok(checkSourceListing(listing, undefined).problems.some((problem) => problem.includes('no index.ts')));
  });

  it('flags dependencies and install scripts in package.json text', () => {
    assert.deepEqual(checkPackageJsonText('{"peerDependencies":{"x":"1"}}'), []);
    const problems = checkPackageJsonText('{"dependencies":{"x":"1"},"scripts":{"prepare":"x"}}');
    assert.equal(problems.length, 2);
  });

  it('finds candidate extension directories, skipping tests', () => {
    assert.deepEqual(findExtensionRoots(listing), ['extension']);
    assert.deepEqual(findExtensionRoots([{ path: 'index.ts', kind: 'file' }]), ['']);
  });
});
