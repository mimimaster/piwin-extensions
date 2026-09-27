// Read-only GitHub lookups for the submit form (unauthenticated public API,
// 60 requests per hour per IP). Responses are cached for the page's lifetime.

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const cache = new Map();

export class GitHubLookupError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'GitHubLookupError';
    this.kind = kind;
  }
}

/**
 * Accepts https://github.com/o/r, github.com/o/r/tree/main/x, git@github.com:o/r.git, o/r.
 * Returns { owner, repo, url } or null.
 */
export function parseRepositoryInput(value) {
  const text = value.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const match =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)(?:\/.*)?$/.exec(text) ??
    /^git@github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(text) ??
    /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(text);
  if (!match) return null;
  const [, owner, repo] = match;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

async function request(url, kind) {
  if (cache.has(url)) return cache.get(url);
  const pending = (async () => {
    let response;
    try {
      response = await fetch(url, kind === 'json' ? { headers: { accept: 'application/vnd.github+json' } } : {});
    } catch {
      throw new GitHubLookupError('连不上 GitHub，请检查网络后重试。', 'network');
    }
    if (response.status === 404) return null;
    if (response.status === 403 || response.status === 429) {
      if (response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        const minutes = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : 60;
        throw new GitHubLookupError(
          `GitHub 接口限流（未登录每小时 60 次），约 ${minutes} 分钟后恢复。可以先手动填写，CI 仍会完整检查。`,
          'rate-limit',
        );
      }
    }
    if (!response.ok) throw new GitHubLookupError(`GitHub 返回 HTTP ${response.status}`, 'http');
    return kind === 'json' ? response.json() : response.text();
  })();
  cache.set(url, pending);
  pending.catch(() => cache.delete(url));
  return pending;
}

export async function fetchRepository(owner, repo) {
  const data = await request(`${API}/repos/${owner}/${repo}`, 'json');
  if (!data) throw new GitHubLookupError('找不到这个仓库。它需要是公开仓库。', 'not-found');
  const spdx = data.license?.spdx_id;
  return {
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    description: data.description ?? '',
    license: spdx && spdx !== 'NOASSERTION' ? spdx : '',
    homepage: typeof data.homepage === 'string' && data.homepage.startsWith('https://') ? data.homepage : '',
    topics: Array.isArray(data.topics) ? data.topics : [],
    defaultBranch: data.default_branch,
    parent: data.parent?.full_name ?? null,
    isPrivate: data.private === true,
    archived: data.archived === true,
  };
}

/** Commit SHA at the tip of `ref`. */
export async function fetchHeadCommit(owner, repo, ref) {
  const data = await request(`${API}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, 'json');
  if (!data) throw new GitHubLookupError(`找不到分支 ${ref}。`, 'not-found');
  return data.sha;
}

/**
 * Full file listing at a commit, in the shape source-rules.mjs expects.
 * Returns null when the commit is not in the repository.
 */
export async function fetchListing(owner, repo, commit) {
  const data = await request(`${API}/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`, 'json');
  if (!data) return null;
  const listing = data.tree.map((item) => ({
    path: item.path,
    kind: item.mode === '120000' ? 'symlink' : item.type === 'tree' ? 'dir' : 'file',
    size: item.size ?? 0,
  }));
  return { listing, truncated: data.truncated === true };
}

/** File text at a commit, or null when absent. */
export function fetchRawText(owner, repo, commit, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return request(`${RAW}/${owner}/${repo}/${commit}/${encoded}`, 'text');
}
