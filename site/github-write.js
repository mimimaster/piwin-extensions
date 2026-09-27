// Authenticated GitHub calls made with the signed-in user's own token. Every
// write is attributed to that user, which is what keeps the registry's
// ownership rules meaningful.

const API = 'https://api.github.com';

export class GitHubWriteError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubWriteError';
    this.status = status;
  }
}

export function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function textToBase64(text) {
  return toBase64(new TextEncoder().encode(text));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createGitHubWriter(token) {
  async function call(method, path, body, { allow404 = false } = {}) {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new GitHubWriteError('连不上 GitHub，请检查网络后重试。', 0);
    }
    if (allow404 && response.status === 404) return null;
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    if (response.status === 401) throw new GitHubWriteError('GitHub 授权已失效，请重新登录。', 401);
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new GitHubWriteError('GitHub 接口限流了，请过几分钟再试。', 403);
    }
    const detail = [data.message, ...(Array.isArray(data.errors) ? data.errors.map((error) => error.message ?? error.code) : [])]
      .filter(Boolean)
      .join('；');
    throw new GitHubWriteError(`GitHub ${method} ${path.split('?')[0]} 失败（${response.status}）：${detail || '未知错误'}`, response.status);
  }

  const writer = {
    user: () => call('GET', '/user'),
    listRepositories: (page = 1) =>
      call('GET', `/user/repos?visibility=public&affiliation=owner&sort=updated&per_page=100&page=${page}`),
    getRepo: (owner, repo) => call('GET', `/repos/${owner}/${repo}`, undefined, { allow404: true }),
    createRepo: (fields) =>
      call('POST', '/user/repos', { ...fields, auto_init: true, has_wiki: false, has_projects: false }),
    setTopics: (owner, repo, names) => call('PUT', `/repos/${owner}/${repo}/topics`, { names }),

    async headSha(owner, repo, branch, { attempts = 1 } = {}) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const ref = await call('GET', `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, undefined, { allow404: true });
        if (ref) return ref.object.sha;
        await wait(1500);
      }
      throw new GitHubWriteError(`${owner}/${repo} 的 ${branch} 分支还没准备好，请稍后重试。`, 404);
    },
    commitTree: async (owner, repo, sha) => (await call('GET', `/repos/${owner}/${repo}/git/commits/${sha}`)).tree.sha,
    listTree: (owner, repo, treeSha) => call('GET', `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`),
    createBlob: async (owner, repo, base64) =>
      (await call('POST', `/repos/${owner}/${repo}/git/blobs`, { content: base64, encoding: 'base64' })).sha,
    createTree: async (owner, repo, tree) => (await call('POST', `/repos/${owner}/${repo}/git/trees`, { tree })).sha,
    createCommit: async (owner, repo, message, tree, parents) =>
      (await call('POST', `/repos/${owner}/${repo}/git/commits`, { message, tree, parents })).sha,
    updateBranch: (owner, repo, branch, sha) =>
      call('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false }),
    createBranch: (owner, repo, branch, sha) =>
      call('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha }),

    /** Fork (or find the existing fork) and wait until its default branch exists. */
    async ensureFork(owner, repo) {
      const fork = await call('POST', `/repos/${owner}/${repo}/forks`, { default_branch_only: true });
      const [forkOwner, forkRepo] = fork.full_name.split('/');
      await writer.headSha(forkOwner, forkRepo, fork.default_branch ?? 'main', { attempts: 40 });
      return { owner: forkOwner, repo: forkRepo, branch: fork.default_branch ?? 'main' };
    },
    /** Best effort: a stale fork only makes the PR "behind", entries are independent files. */
    async syncFork(owner, repo, branch) {
      try {
        await call('POST', `/repos/${owner}/${repo}/merge-upstream`, { branch });
      } catch (error) {
        if (!(error instanceof GitHubWriteError) || error.status === 401) throw error;
      }
    },
    getContent: (owner, repo, path, ref) =>
      call('GET', `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, undefined, { allow404: true }),
    putContent: (owner, repo, path, fields) => call('PUT', `/repos/${owner}/${repo}/contents/${path}`, fields),
    openPull: (owner, repo, fields) => call('POST', `/repos/${owner}/${repo}/pulls`, fields),
  };
  return writer;
}
