// Browser-side publishing pipeline, run in Node against a fake GitHub API.
// The site modules are loaded from a fresh build (they import ./lib/*.mjs,
// which build-site.mjs copies next to them).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
let site;

before(async () => {
  const out = await mkdtemp(join(tmpdir(), 'piwin-site-'));
  await run('node', [join(repoRoot, 'scripts/build-site.mjs'), out, '--index-root', join(repoRoot, 'schema/fixtures/valid')]);
  globalThis.window = { location: { origin: 'https://mimimaster.github.io', pathname: '/piwin-extensions/', hash: '' } };
  const load = (name) => import(pathToFileURL(join(out, name)).href);
  site = {
    files: await load('upload-files.js'),
    zip: await load('zip-reader.js'),
    inspect: await load('upload-inspect.js'),
    publish: await load('publish-flow.js'),
    github: await load('github-write.js'),
    entry: await load('lib/entry.mjs'),
  };
});

const text = (value) => new TextEncoder().encode(value);
const file = (path, value) => ({ path, bytes: text(value) });
const INDEX_TS = 'export default function (pi) {}\n';

describe('upload intake', () => {
  it('unwraps one top folder, skips junk, keeps nested paths', () => {
    const { files, skipped, rootName } = site.files.normalizeUpload([
      file('hello/index.ts', INDEX_TS),
      file('hello/lib/util.ts', 'export const x = 1;\n'),
      file('hello/node_modules/left-pad/index.js', ''),
      file('hello/.git/HEAD', 'ref'),
      file('hello/.DS_Store', ''),
    ]);
    assert.equal(rootName, 'hello');
    assert.deepEqual(files.map((item) => item.path), ['index.ts', 'lib/util.ts']);
    assert.equal(skipped.length, 3);
  });

  it('turns a lone .ts module into index.ts', () => {
    const { files, rootName } = site.files.normalizeUpload([file('greeter.ts', INDEX_TS)]);
    assert.deepEqual(files.map((item) => item.path), ['index.ts']);
    assert.equal(rootName, 'greeter');
  });

  it('reads stored and deflated zip entries and flags symlinks', async () => {
    const zip = await buildZip([
      { path: 'hello/index.ts', data: text(INDEX_TS), deflate: true },
      { path: 'hello/package.json', data: text('{"name":"hello"}'), deflate: false },
      { path: 'hello/link', data: text('/etc/passwd'), symlink: true },
    ]);
    const entries = await site.zip.readZip(zip.buffer);
    assert.deepEqual(entries.map((entry) => entry.path), ['hello/index.ts', 'hello/package.json', 'hello/link']);
    assert.equal(new TextDecoder().decode(entries[0].bytes), INDEX_TS);
    assert.equal(entries[2].symlink, true);
    const inspected = site.inspect.inspectUpload(site.files.normalizeUpload(entries));
    assert.ok(inspected.problems.some((problem) => problem.includes('symbolic link')));
  });

  it('infers metadata from package.json and applies the CI source rules', () => {
    const upload = site.files.normalizeUpload([
      file('index.ts', INDEX_TS),
      file('package.json', JSON.stringify({ name: '@me/pi-hello', version: '1.2.0', description: 'Hi', license: 'MIT', keywords: ['demo', 'pi-package'], dependencies: { chalk: '5' } })),
    ]);
    const inspected = site.inspect.inspectUpload(upload);
    assert.deepEqual(inspected.meta, {
      slug: 'pi-hello',
      name: 'Pi Hello',
      description: 'Hi',
      version: '1.2.0',
      license: 'MIT',
      keywords: ['demo'],
      homepage: '',
    });
    assert.ok(inspected.problems.some((problem) => problem.includes('dependencies')));
    assert.equal(site.publish.sourceRepoName('pi-hello'), 'piwin-hello');
  });
});

describe('publishing against a fake GitHub', () => {
  it('lists owned public repositories and publishes an existing commit without changing source', async () => {
    const github = fakeGitHub({ login: 'Yorick', repos: {
      'Yorick/command-code': { files: { 'index.ts': INDEX_TS, 'package.json': '{"version":"1.0.0"}' } },
    } });
    const repos = await site.github.createGitHubWriter('t').listRepositories();
    assert.ok(repos.some((repo) => repo.full_name === 'Yorick/command-code'));
    const commit = github.headOf('Yorick/command-code');
    const steps = [];
    const result = await site.publish.publishExistingExtension({
      token: 't', repository: 'https://github.com/Yorick/command-code', commit, subdir: '',
      meta: { slug: 'command-code', name: 'Command Code', description: 'Code commands', version: '1.0.0', license: 'MIT', keywords: [], homepage: '' },
      registry: 'mimimaster/piwin-extensions', extensions: [], onStep: (step) => steps.push(step),
    });
    assert.deepEqual(steps, ['account', 'repo', 'fork', 'entry', 'pr']);
    assert.equal(result.commit, commit);
    assert.equal(github.headOf('Yorick/command-code'), commit);
    assert.ok(!github.calls.some((call) => call.startsWith('POST /repos/Yorick/command-code')));
    const entry = JSON.parse(github.contentOf('Yorick/piwin-extensions', 'extensions/yorick/command-code.json'));
    assert.deepEqual(site.entry.validateEntry(entry, 'yorick/command-code'), []);
    assert.equal(entry.versions[0].commit, commit);
  });

  it('rejects a repository that moved after selection', async () => {
    const github = fakeGitHub({ login: 'Yorick', repos: { 'Yorick/hello': { files: { 'index.ts': INDEX_TS } } } });
    await assert.rejects(site.publish.publishExistingExtension({
      token: 't', repository: 'https://github.com/Yorick/hello', commit: '0'.repeat(40), subdir: '',
      meta: { slug: 'hello', name: 'Hello', description: '', version: '1.0.0', license: 'MIT', keywords: [], homepage: '' },
      registry: 'mimimaster/piwin-extensions', extensions: [], onStep: () => undefined,
    }), /新提交/);
    assert.equal(github.pulls.length, 0);
  });

  it('creates the source repo, commits the upload, forks the registry and opens the PR', async () => {
    const github = fakeGitHub({ login: 'Yorick' });
    const steps = [];
    const result = await site.publish.publishNewExtension({
      token: 't',
      files: site.files.normalizeUpload([file('index.ts', INDEX_TS)]).files,
      meta: { slug: 'hello', name: 'Hello', description: 'Says hi', version: '1.0.0', license: 'MIT', keywords: [], homepage: '' },
      forkOf: { id: 'alice/git-autopilot', version: '1.1.0' },
      registry: 'mimimaster/piwin-extensions',
      extensions: [],
      onStep: (step) => steps.push(step),
    });
    assert.deepEqual([...new Set(steps)], ['account', 'repo', 'push', 'fork', 'entry', 'pr']);
    assert.equal(result.id, 'yorick/hello');
    assert.equal(result.repository, 'https://github.com/Yorick/piwin-hello');
    assert.equal(result.prUrl, 'https://github.com/mimimaster/piwin-extensions/pull/7');

    const tree = github.treeOf('Yorick/piwin-hello', result.commit);
    assert.deepEqual(tree.map((entry) => entry.path).sort(), ['LICENSE', 'README.md', 'index.ts']);
    assert.ok(tree.find((entry) => entry.path === 'index.ts').content === INDEX_TS);
    assert.deepEqual(github.topics.get('Yorick/piwin-hello'), ['pi-package', 'piwin-extension']);

    const pull = github.pulls[0];
    assert.match(pull.head, /^Yorick:publish\/yorick\/hello-/);
    const written = JSON.parse(github.contentOf('Yorick/piwin-extensions', 'extensions/yorick/hello.json'));
    assert.deepEqual(site.entry.validateEntry(written, 'yorick/hello'), []);
    assert.equal(written.versions[0].commit, result.commit);
    assert.deepEqual(written.owners, ['yorick']);
    assert.deepEqual(written.forkOf, { id: 'alice/git-autopilot', version: '1.1.0' });
  });

  it('lets the registry owner branch upstream instead of forking', async () => {
    const github = fakeGitHub({ login: 'mimimaster' });
    await site.publish.publishNewExtension({
      token: 't',
      files: [file('index.ts', INDEX_TS)],
      meta: { slug: 'goal', name: 'Goal', description: '', version: '0.1.0', license: 'Apache-2.0', keywords: [], homepage: '' },
      registry: 'mimimaster/piwin-extensions',
      extensions: [],
      onStep: () => undefined,
    });
    assert.equal(github.calls.filter((call) => call.endsWith('/forks')).length, 0);
    assert.match(github.pulls[0].head, /^publish\/mimimaster\/goal-/);
    assert.ok(!github.treeOf('mimimaster/piwin-goal', github.lastCommit).some((entry) => entry.path === 'LICENSE'));
  });

  it('refuses to overwrite an unrelated repository of the same name', async () => {
    fakeGitHub({ login: 'yorick', repos: { 'yorick/piwin-hello': { topics: [] } } });
    await assert.rejects(
      site.publish.publishNewExtension({
        token: 't',
        files: [file('index.ts', INDEX_TS)],
        meta: { slug: 'hello', name: 'Hello', description: '', version: '1.0.0', license: 'MIT', keywords: [], homepage: '' },
        registry: 'mimimaster/piwin-extensions',
        extensions: [],
        onStep: () => undefined,
      }),
      /不是 piwin 扩展/,
    );
  });

  it('publishes a new version: replaces the source, keeps README, prepends the version', async () => {
    const github = fakeGitHub({
      login: 'yorick',
      repos: {
        'yorick/piwin-hello': {
          topics: ['piwin-extension'],
          files: { 'README.md': '# Hello', 'index.ts': 'old', 'old-helper.ts': 'old' },
        },
      },
    });
    const entry = {
      id: 'yorick/hello',
      name: 'Hello',
      description: '',
      owners: ['yorick'],
      repository: 'https://github.com/yorick/piwin-hello',
      license: 'MIT',
      versions: [{ version: '1.0.0', commit: 'a'.repeat(40) }],
    };
    const result = await site.publish.publishNewVersion({
      token: 't',
      entry,
      files: [file('index.ts', INDEX_TS)],
      version: '1.1.0',
      registry: 'mimimaster/piwin-extensions',
      onStep: () => undefined,
    });
    const tree = github.treeOf('yorick/piwin-hello', result.commit);
    assert.deepEqual(tree.map((item) => item.path).sort(), ['README.md', 'index.ts']);
    const written = JSON.parse(github.contentOf('yorick/piwin-extensions', 'extensions/yorick/hello.json'));
    assert.deepEqual(written.versions.map((version) => version.version), ['1.1.0', '1.0.0']);
    assert.equal(github.pulls[0].title, 'Release yorick/hello 1.1.0');

    await assert.rejects(
      site.publish.publishNewVersion({ token: 't', entry: { ...entry, owners: ['alice'] }, files: [], version: '2.0.0', registry: 'mimimaster/piwin-extensions', onStep: () => undefined }),
      /只有维护者/,
    );
  });
});

/** In-memory GitHub REST API: just enough of repos, git data, forks, contents, pulls. */
function fakeGitHub({ login, repos = {} }) {
  let counter = 0;
  const nextSha = () => (++counter).toString(16).padStart(40, '0');
  const state = {
    repos: new Map(),
    refs: new Map(),
    commits: new Map(),
    trees: new Map(),
    contents: new Map(),
    topics: new Map(),
    pulls: [],
    calls: [],
    lastCommit: null,
  };
  const addRepo = (fullName, { topics = [], files = {} } = {}) => {
    const tree = nextSha();
    state.trees.set(tree, Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', sha: nextSha(), content })));
    const commit = nextSha();
    state.commits.set(commit, { tree });
    state.repos.set(fullName.toLowerCase(), {
      full_name: fullName, html_url: `https://github.com/${fullName}`, default_branch: 'main', topics,
      owner: { login: fullName.split('/')[0] }, private: false, archived: false,
      permissions: { push: fullName.split('/')[0].toLowerCase() === login.toLowerCase() },
    });
    state.refs.set(`${fullName.toLowerCase()}#main`, commit);
    state.topics.set(fullName, topics);
  };
  addRepo('mimimaster/piwin-extensions');
  for (const [name, options] of Object.entries(repos)) addRepo(name, options);

  globalThis.fetch = async (url, init = {}) => {
    try {
      return await route(url, init);
    } catch (error) {
      // Surface fake-API bugs instead of the writer's network message.
      console.error('fake GitHub failed on', init.method ?? 'GET', url, error);
      throw error;
    }
  };
  const route = async (url, init) => {
    const parsed = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = decodeURIComponent(parsed.pathname);
    state.calls.push(`${method} ${path}`);
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    const notFound = () => json({ message: 'Not Found' }, 404);
    let match;
    if (path === '/user') return json({ login });
    if (method === 'GET' && path === '/user/repos') {
      return json([...state.repos.values()].filter((repo) => repo.owner.login.toLowerCase() === login.toLowerCase()));
    }
    if (method === 'POST' && path === '/user/repos') {
      addRepo(`${login}/${body.name}`, { files: { 'README.md': 'auto' } });
      return json(state.repos.get(`${login}/${body.name}`.toLowerCase()), 201);
    }
    if ((match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path))) {
      const repoName = match[2];
      const fullName = `${match[1]}/${repoName}`;
      const key = fullName.toLowerCase();
      const rest = match[3] ?? '';
      if (rest === '') return state.repos.has(key) ? json(state.repos.get(key)) : notFound();
      if (rest === '/topics') {
        state.topics.set(fullName, body.names);
        return json(body);
      }
      if ((match = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) {
        const sha = state.refs.get(`${key}#${match[1]}`);
        return sha ? json({ object: { sha } }) : notFound();
      }
      if ((match = /^\/git\/commits\/(\w+)$/.exec(rest))) return json({ tree: { sha: state.commits.get(match[1]).tree } });
      if ((match = /^\/git\/trees\/(\w+)$/.exec(rest)) && method === 'GET') {
        return json({ tree: state.trees.get(match[1]).map(({ content: _c, ...item }) => item), truncated: false });
      }
      if (rest === '/git/blobs') return json({ sha: nextSha() }, 201);
      if (rest === '/git/trees') {
        const sha = nextSha();
        state.trees.set(sha, body.tree);
        return json({ sha }, 201);
      }
      if (rest === '/git/commits') {
        const sha = nextSha();
        state.commits.set(sha, { tree: body.tree, parents: body.parents });
        state.lastCommit = sha;
        return json({ sha }, 201);
      }
      if ((match = /^\/git\/refs\/heads\/(.+)$/.exec(rest)) && method === 'PATCH') {
        state.refs.set(`${key}#${match[1]}`, body.sha);
        return json({});
      }
      if (rest === '/git/refs' && method === 'POST') {
        state.refs.set(`${key}#${body.ref.replace('refs/heads/', '')}`, body.sha);
        return json({}, 201);
      }
      if (rest === '/forks') {
        const forkName = `${login}/${repoName}`;
        if (!state.repos.has(forkName.toLowerCase())) addRepo(forkName);
        return json(state.repos.get(forkName.toLowerCase()), 202);
      }
      if (rest === '/merge-upstream') return json({ merge_type: 'none' });
      if ((match = /^\/contents\/(.+)$/.exec(rest))) {
        const contentKey = `${key}#${match[1]}`;
        if (method === 'GET') return state.contents.has(contentKey) ? json({ sha: 'x' }) : notFound();
        state.contents.set(contentKey, Buffer.from(body.content, 'base64').toString('utf8'));
        return json({ content: {} }, 201);
      }
      if (rest === '/pulls') {
        state.pulls.push(body);
        return json({ html_url: `https://github.com/${fullName}/pull/7`, number: 7 }, 201);
      }
    }
    return notFound();
  };

  return {
    calls: state.calls,
    headOf: (repo) => state.refs.get(`${repo.toLowerCase()}#main`),
    pulls: state.pulls,
    topics: state.topics,
    get lastCommit() {
      return state.lastCommit;
    },
    treeOf: (_repo, commit) => state.trees.get(state.commits.get(commit).tree),
    contentOf: (repo, path) => state.contents.get(`${repo.toLowerCase()}#${path}`),
  };
}

/** Tiny ZIP writer for tests (CRC left at 0; the reader does not check it). */
async function buildZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = text(entry.path);
    const data = entry.deflate
      ? new Uint8Array(await new Response(new Blob([entry.data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
      : entry.data;
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(8, entry.deflate ? 8 : 0, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, entry.data.length, true);
    header.setUint16(26, name.length, true);
    local.push(new Uint8Array(header.buffer), name, data);
    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(10, entry.deflate ? 8 : 0, true);
    record.setUint32(20, data.length, true);
    record.setUint32(24, entry.data.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(38, entry.symlink ? (0o120777 << 16) >>> 0 : 0, true);
    record.setUint32(42, offset, true);
    central.push(new Uint8Array(record.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
