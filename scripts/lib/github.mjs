// Minimal GitHub REST client for the PR check (Node >= 20 global fetch).
// Head-side files are fetched as data only; nothing from the PR is executed.

const API = 'https://api.github.com';

export function createGitHubClient(token) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'piwin-extensions-ci',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  async function call(method, path, body) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new Error(`GitHub ${method} ${path} failed: HTTP ${response.status} ${await response.text()}`);
    }
    return response.status === 204 ? null : response.json();
  }

  return {
    /** Every file of a PR, with rename sources, across pages. */
    async listPullFiles(repo, number) {
      const files = [];
      for (let page = 1; page <= 30; page += 1) {
        const batch = await call('GET', `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
        files.push(...batch);
        if (batch.length < 100) break;
      }
      return files;
    },

    /** Raw file text at a commit of the PR head repository. */
    async readFile(repo, path, ref) {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${API}/repos/${repo}/contents/${encoded}?ref=${ref}`, {
        headers: { ...headers, accept: 'application/vnd.github.raw' },
      });
      if (!response.ok) throw new Error(`cannot read ${path}@${ref}: HTTP ${response.status}`);
      return response.text();
    },

    async isPublicOrgMember(org, user) {
      const response = await fetch(`${API}/orgs/${org}/public_members/${user}`, { headers });
      return response.status === 204;
    },

    /** Create or update the single comment that carries `marker`. */
    async upsertComment(repo, number, marker, body) {
      const comments = await call('GET', `/repos/${repo}/issues/${number}/comments?per_page=100`);
      const existing = comments.find((comment) => typeof comment.body === 'string' && comment.body.includes(marker));
      if (existing) await call('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
      else await call('POST', `/repos/${repo}/issues/${number}/comments`, { body });
    },
  };
}
