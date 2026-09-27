import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { parseEntryPath, validateEntry } from './lib/entry.mjs';
import { checkPullRequest } from './lib/pr-rules.mjs';
import { changedFiles, readEntries } from './lib/registry-tree.mjs';
import { checkPinnedSource, checkTree } from './lib/source-check.mjs';

const run = promisify(execFile);
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
    await writeFile(join(root, path), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  }
  return root;
}

async function prCheck(baseFiles, headFiles, author) {
  const [baseRoot, headRoot] = await Promise.all([tree(baseFiles), tree(headFiles)]);
  const [base, head, changed] = await Promise.all([
    readEntries(baseRoot),
    readEntries(headRoot),
    changedFiles(baseRoot, headRoot),
  ]);
  return checkPullRequest({
    base: base.entries,
    head: head.entries,
    headStrayFiles: head.strayFiles,
    changed,
    author,
    isPublicOrgMember: async (org, user) => org === 'acme' && user === 'bob',
  });
}

describe('entry validation', () => {
  it('accepts a minimal entry and derives the id from the path', () => {
    assert.deepEqual(validateEntry(entry()), []);
    assert.deepEqual(parseEntryPath('extensions/alice/git-autopilot.json'), {
      owner: 'alice',
      name: 'git-autopilot',
      id: 'alice/git-autopilot',
    });
    assert.equal(parseEntryPath('extensions/Alice/x.json'), null);
  });

  it('rejects moving refs, unknown keys and escaping subdirs', () => {
    const problems = validateEntry(
      entry({ subdir: '../x', extra: true, versions: [{ version: '1.0.0', commit: 'main' }] }),
    );
    assert.ok(problems.some((problem) => problem.includes('unknown key "extra"')));
    assert.ok(problems.some((problem) => problem.includes('subdir')));
    assert.ok(problems.some((problem) => problem.includes('40-hex')));
  });
});

describe('pull request rules', () => {
  it('lets a user add an entry under their own handle', async () => {
    const result = await prCheck({}, { 'extensions/alice/git-autopilot.json': entry() }, 'alice');
    assert.deepEqual(result.problems, []);
    assert.equal(result.versionsToCheck.length, 1);
  });

  it('allows public org members and rejects squatting another handle', async () => {
    const org = await prCheck(
      {},
      { 'extensions/acme/tool.json': entry({ owners: ['bob'] }) },
      'bob',
    );
    assert.deepEqual(org.problems, []);
    const squat = await prCheck({}, { 'extensions/alice/tool.json': entry({ owners: ['mallory'] }) }, 'mallory');
    assert.ok(squat.problems.some((problem) => problem.includes('your own handle')));
  });

  it('only owners may edit, and published versions are immutable', async () => {
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

    const bumped = await prCheck(
      base,
      {
        'extensions/alice/git-autopilot.json': entry({
          versions: [
            { version: '1.1.0', commit: B },
            { version: '1.0.0', commit: A, yanked: { reason: 'data loss on rebase' } },
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
  });

  it('checks fork bases and copyleft licenses', async () => {
    const base = { 'extensions/alice/git-autopilot.json': entry({ license: 'GPL-3.0-only' }) };
    const forkFiles = (license, version = '1.0.0') => ({
      ...base,
      'extensions/yorick/git-autopilot.json': entry({
        owners: ['yorick'],
        repository: 'https://github.com/yorick/git-autopilot',
        license,
        forkOf: { id: 'alice/git-autopilot', version },
      }),
    });
    assert.deepEqual((await prCheck(base, forkFiles('GPL-3.0-only'), 'yorick')).problems, []);
    const relicensed = await prCheck(base, forkFiles('MIT'), 'yorick');
    assert.ok(relicensed.problems.some((problem) => problem.includes('must keep license')));
    const missing = await prCheck(base, forkFiles('GPL-3.0-only', '9.9.9'), 'yorick');
    assert.ok(missing.problems.some((problem) => problem.includes('no version 9.9.9')));
  });

  it('rejects edits outside extensions/ and unformatted JSON', async () => {
    const result = await prCheck(
      { 'scripts/x.mjs': 'a' },
      {
        'scripts/x.mjs': 'b',
        'extensions/alice/git-autopilot.json': JSON.stringify(entry()),
      },
      'alice',
    );
    assert.ok(result.problems.some((problem) => problem.startsWith('scripts/x.mjs')));
    assert.ok(result.problems.some((problem) => problem.includes('2-space JSON')));
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

  it('fetches exactly the pinned commit', async () => {
    const repo = await tree({ 'index.ts': 'export const v = 1;\n' });
    await run('git', ['init', '-q'], { cwd: repo });
    await run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'empty'], {
      cwd: repo,
    });
    const empty = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
    await run('git', ['add', '.'], { cwd: repo });
    await run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'v1'], { cwd: repo });
    const withIndex = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

    assert.deepEqual(await checkPinnedSource({ repository: repo, commit: withIndex }), []);
    const problems = await checkPinnedSource({ repository: repo, commit: empty });
    assert.ok(problems.some((problem) => problem.includes('no index.ts')));
  });
});
