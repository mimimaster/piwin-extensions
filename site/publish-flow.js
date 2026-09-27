// One-click publishing with the user's own token:
//   source repo in the user's account ← uploaded files (one commit)
//   registry fork ← branch ← entry file → pull request upstream
// The PR author is the user, so the registry CI judges it like any other PR.
import { formatEntry, validateEntry } from './lib/entry.mjs';
import { canonicalEntry, entryFromIndex } from './entry-builder.js';
import { decodeText } from './upload-files.js';
import { createGitHubWriter, textToBase64, toBase64 } from './github-write.js';
import { parseRepositoryInput } from './github-api.js';

export const PUBLISH_STEPS = [
  ['account', '确认 GitHub 账号'],
  ['repo', '准备源码仓库'],
  ['push', '上传文件并提交'],
  ['fork', '准备扩展仓库的 fork'],
  ['entry', '写入条目'],
  ['pr', '创建 PR'],
];

/** `hello` → `piwin-hello`; `pi-hello` → `piwin-hello`; `piwin-x` stays. */
export function sourceRepoName(slug) {
  if (slug.startsWith('piwin')) return slug;
  return `piwin-${slug.replace(/^pi-/, '')}`;
}

const KEEP_WHEN_MISSING = [/^README(\.[a-z]+)?$/i, /^LICEN[CS]E(\.[a-z]+)?$/i, /^\.gitignore$/, /^\.github\//];

/**
 * @param {object} input
 * @param {string} input.token
 * @param {Array<{ path, bytes }>} input.files  normalized upload
 * @param {{ slug, name, description, version, license, keywords, homepage }} input.meta
 * @param {{ id, version } | undefined} input.forkOf
 * @param {string} input.registry  "owner/repo" of the registry
 * @param {Array} input.extensions  current index
 * @param {(step: string, detail?: string) => void} input.onStep
 */
export async function publishNewExtension(input) {
  const github = createGitHubWriter(input.token);
  input.onStep('account');
  const login = (await github.user()).login;
  const owner = login.toLowerCase();
  const id = `${owner}/${input.meta.slug}`;
  if (input.extensions.some((entry) => entry.id === id)) {
    throw new Error(`${id} 已经在仓库里了。要发新版本，请到它的详情页上传。`);
  }
  const repoName = sourceRepoName(input.meta.slug);
  const repository = `https://github.com/${login}/${repoName}`;
  const draft = entryFor(input.meta, owner, repository, input.forkOf, '0'.repeat(40));
  const problems = validateEntry(draft, id);
  if (problems.length > 0) throw new Error(`条目不合规：${problems.join('；')}`);

  input.onStep('repo', `${login}/${repoName}`);
  const existing = await github.getRepo(login, repoName);
  if (existing && !(existing.topics ?? []).includes('piwin-extension')) {
    throw new Error(`你的账号下已经有一个叫 ${repoName} 的仓库，而且不是 piwin 扩展。请换一个扩展标识。`);
  }
  if (!existing) {
    await github.createRepo({ name: repoName, description: input.meta.description.slice(0, 350), homepage: siteUrl(id) });
  }
  await github.setTopics(login, repoName, ['pi-package', 'piwin-extension']);

  input.onStep('push', `${input.files.length} 个文件`);
  const files = withGeneratedFiles(input.files, input.meta, login);
  const commit = await commitUpload(github, login, repoName, files, `Publish ${input.meta.version} from the piwin extension registry`, {
    keepFromHead: Boolean(existing),
  });

  const entry = entryFor(input.meta, owner, repository, input.forkOf, commit);
  return openRegistryPull(github, {
    login,
    registry: input.registry,
    path: `extensions/${id}.json`,
    text: formatEntry(entry),
    title: `Add ${id} ${input.meta.version}`,
    body: `${input.meta.description || input.meta.name}\n\n- 源码：${repository}/commit/${commit}\n${input.forkOf ? `- 改装自：${input.forkOf.id} ${input.forkOf.version}\n` : ''}\n由扩展仓库网页一键发布。`,
    onStep: input.onStep,
    result: { id, repository, commit },
  });
}

/** Publish a pinned commit from an existing public repository without changing its source. */
export async function publishExistingExtension(input) {
  const github = createGitHubWriter(input.token);
  input.onStep('account');
  const login = (await github.user()).login;
  const owner = login.toLowerCase();
  const parsed = parseRepositoryInput(input.repository);
  if (!parsed || parsed.owner.toLowerCase() !== owner) {
    throw new Error('只能选择自己账号下的 GitHub 仓库。');
  }
  const repoName = parsed.repo;
  const repository = `https://github.com/${login}/${repoName}`;
  const id = `${owner}/${input.meta.slug}`;
  if (input.extensions.some((entry) => entry.id === id)) {
    throw new Error(`${id} 已经在仓库里了。要发新版本，请到它的详情页上传。`);
  }
  input.onStep('repo', `${login}/${repoName}`);
  const repo = await github.getRepo(login, repoName);
  if (!repo || repo.private || repo.archived || repo.disabled || repo.owner?.login?.toLowerCase() !== owner) {
    throw new Error('只能选择自己账号下的公开、可用仓库。');
  }
  if (!repo.permissions?.push) throw new Error('你对这个仓库没有写权限。');
  if (!/^[0-9a-f]{40}$/i.test(input.commit)) throw new Error('源码 commit 无效，请重新选择仓库。');
  const commit = input.commit.toLowerCase();
  if (await github.headSha(login, repoName, repo.default_branch) !== commit) {
    throw new Error('仓库默认分支已有新提交，请重新选择仓库并检查源码。');
  }
  const entry = canonicalEntry({
    name: input.meta.name.trim(),
    description: input.meta.description.trim(),
    owners: [owner],
    repository,
    subdir: input.subdir,
    license: input.meta.license.trim(),
    keywords: input.meta.keywords,
    homepage: input.meta.homepage,
    forkOf: input.forkOf,
    versions: [{ version: input.meta.version.trim(), commit, publishedAt: nowIso() }],
  });
  const problems = validateEntry(entry, id);
  if (problems.length > 0) throw new Error(`条目不合规：${problems.join('；')}`);
  return openRegistryPull(github, {
    login,
    registry: input.registry,
    path: `extensions/${id}.json`,
    text: formatEntry(entry),
    title: `Add ${id} ${input.meta.version}`,
    body: `${input.meta.description || input.meta.name}\n\n- 源码：${repository}/commit/${commit}\n\n由扩展仓库网页选择现有 GitHub 仓库发布。`,
    onStep: input.onStep,
    result: { id, repository, commit },
  });
}

/**
 * New version of a listed extension: push the upload to its repository
 * (inside `subdir` when it has one), then add the version to the entry.
 */
export async function publishNewVersion(input) {
  const github = createGitHubWriter(input.token);
  const indexEntry = input.entry;
  input.onStep('account');
  const login = (await github.user()).login;
  if (!indexEntry.owners.includes(login.toLowerCase())) {
    throw new Error(`只有维护者（${indexEntry.owners.join('、')}）能发新版本，当前登录的是 ${login}。`);
  }
  if (indexEntry.versions.some((version) => version.version === input.version)) {
    throw new Error(`版本 ${input.version} 已经发布过，请换一个版本号。`);
  }
  const [, repoOwner, repoName] = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(indexEntry.repository) ?? [];
  input.onStep('repo', `${repoOwner}/${repoName}`);
  const repo = await github.getRepo(repoOwner, repoName);
  if (!repo) throw new Error(`找不到源码仓库 ${indexEntry.repository}。`);
  if (!repo.permissions?.push) throw new Error(`你对 ${repoOwner}/${repoName} 没有写权限，请用 git 推送后在「手动填写」里发版本。`);

  input.onStep('push', `${input.files.length} 个文件`);
  const commit = await commitUpload(github, repoOwner, repoName, input.files, `Release ${input.version}`, {
    keepFromHead: true,
    subdir: indexEntry.subdir,
    branch: repo.default_branch,
  });

  const entry = entryFromIndex(indexEntry);
  entry.versions = [{ version: input.version, commit, publishedAt: nowIso() }, ...entry.versions];
  const problems = validateEntry(entry, indexEntry.id);
  if (problems.length > 0) throw new Error(`条目不合规：${problems.join('；')}`);
  return openRegistryPull(github, {
    login,
    registry: input.registry,
    path: `extensions/${indexEntry.id}.json`,
    text: formatEntry(entry),
    title: `Release ${indexEntry.id} ${input.version}`,
    body: `- 源码：${indexEntry.repository}/commit/${commit}\n\n由扩展仓库网页一键发布。`,
    onStep: input.onStep,
    result: { id: indexEntry.id, repository: indexEntry.repository, commit },
  });
}

/**
 * One commit on top of the branch head. Text files go into the tree inline;
 * binaries become blobs. With `keepFromHead`, files outside the uploaded
 * scope survive (README/LICENSE/.github at the root, everything outside
 * `subdir`); everything inside the scope is replaced by the upload.
 */
async function commitUpload(github, owner, repo, files, message, { keepFromHead = false, subdir, branch = 'main' } = {}) {
  const head = await github.headSha(owner, repo, branch, { attempts: 10 });
  const prefix = subdir ? (subdir.endsWith('.ts') ? subdir : `${subdir}/`) : '';
  const uploaded = [];
  for (const file of files) {
    const path = subdir && subdir.endsWith('.ts') ? subdir : `${prefix}${file.path}`;
    if (subdir && subdir.endsWith('.ts') && file.path !== 'index.ts') continue;
    const text = decodeText(file.bytes);
    uploaded.push(
      text !== null
        ? { path, mode: '100644', type: 'blob', content: text }
        : { path, mode: '100644', type: 'blob', sha: await github.createBlob(owner, repo, toBase64(file.bytes)) },
    );
  }
  const kept = [];
  if (keepFromHead) {
    const listing = await github.listTree(owner, repo, await github.commitTree(owner, repo, head));
    if (listing.truncated) throw new Error('源码仓库太大，网页无法安全地整体更新；请用 git 推送。');
    const uploadedPaths = new Set(uploaded.map((item) => item.path));
    for (const item of listing.tree) {
      if (item.type === 'tree' || uploadedPaths.has(item.path)) continue;
      const insideScope = subdir ? item.path === subdir || item.path.startsWith(prefix) : !KEEP_WHEN_MISSING.some((pattern) => pattern.test(item.path));
      if (!insideScope) kept.push({ path: item.path, mode: item.mode, type: item.type, sha: item.sha });
    }
  }
  const tree = await github.createTree(owner, repo, [...kept, ...uploaded]);
  const commit = await github.createCommit(owner, repo, message, tree, [head]);
  await github.updateBranch(owner, repo, branch, commit);
  return commit;
}

async function openRegistryPull(github, { login, registry, path, text, title, body, onStep, result }) {
  const [upstreamOwner, upstreamRepo] = registry.split('/');
  onStep('fork');
  // The registry owner cannot fork their own repository; branch upstream instead.
  const isOwner = login.toLowerCase() === upstreamOwner.toLowerCase();
  const target = isOwner
    ? { owner: upstreamOwner, repo: upstreamRepo, branch: 'main' }
    : await github.ensureFork(upstreamOwner, upstreamRepo);
  if (!isOwner) await github.syncFork(target.owner, target.repo, target.branch);
  const base = await github.headSha(target.owner, target.repo, target.branch, { attempts: 5 });
  const branch = `publish/${path.replace(/^extensions\//, '').replace(/\.json$/, '').replace(/[^A-Za-z0-9/-]/g, '-')}-${Date.now().toString(36)}`;
  await github.createBranch(target.owner, target.repo, branch, base);

  onStep('entry', path);
  const current = await github.getContent(target.owner, target.repo, path, branch);
  await github.putContent(target.owner, target.repo, path, {
    message: title,
    content: textToBase64(text),
    branch,
    ...(current ? { sha: current.sha } : {}),
  });

  onStep('pr');
  const pull = await github.openPull(upstreamOwner, upstreamRepo, {
    title,
    head: isOwner ? branch : `${target.owner}:${branch}`,
    base: 'main',
    body,
    maintainer_can_modify: true,
  });
  return { ...result, prUrl: pull.html_url, prNumber: pull.number };
}

function entryFor(meta, owner, repository, forkOf, commit) {
  return canonicalEntry({
    name: meta.name,
    description: meta.description,
    owners: [owner],
    repository,
    license: meta.license,
    keywords: meta.keywords,
    homepage: meta.homepage,
    forkOf,
    versions: [{ version: meta.version, commit, publishedAt: nowIso() }],
  });
}

/** A README and, for MIT, a LICENSE when the upload has none. */
function withGeneratedFiles(files, meta, login) {
  const extra = [];
  const has = (pattern) => files.some((file) => pattern.test(file.path));
  const encode = (text) => new TextEncoder().encode(text);
  if (!has(/^README(\.[a-z]+)?$/i)) {
    extra.push({
      path: 'README.md',
      bytes: encode(`# ${meta.name}\n\n${meta.description}\n\n在 piwin 桌面端「扩展市场」搜索此扩展并点击安装。CLI 暂不使用。\n`),
    });
  }
  if (meta.license === 'MIT' && !has(/^LICEN[CS]E(\.[a-z]+)?$/i)) {
    extra.push({ path: 'LICENSE', bytes: encode(mitLicense(login)) });
  }
  return [...files, ...extra];
}

function mitLicense(holder) {
  return `MIT License

Copyright (c) ${new Date().getFullYear()} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function siteUrl(id) {
  return `${window.location.origin}${window.location.pathname}#/ext/${id}`;
}
