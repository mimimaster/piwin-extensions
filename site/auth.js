// GitHub OAuth for the static site: authorize redirect with state + PKCE,
// code exchange through the Worker, token kept in this tab's sessionStorage.
import { AUTH_WORKER_URL, OAUTH_CLIENT_ID, OAUTH_SCOPE, signInConfigured } from './config.js';

const TOKEN_KEY = 'piwin-extensions:gh-token';
const STATE_KEY = 'piwin-extensions:oauth-state';
const VERIFIER_KEY = 'piwin-extensions:oauth-verifier';
const RETURN_KEY = 'piwin-extensions:oauth-return';

const session = {
  get(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // Without sessionStorage sign-in cannot survive the redirect.
    }
  },
  remove(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Nothing stored.
    }
  },
};

export function getToken() {
  return session.get(TOKEN_KEY);
}

export function signOut() {
  session.remove(TOKEN_KEY);
}

/** Where the OAuth App's callback URL points: this site's root. */
function redirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function randomString(bytes) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signIn() {
  if (!signInConfigured()) throw new Error('站点还没有配置 GitHub 登录。');
  const state = randomString(24);
  const verifier = randomString(48);
  session.set(STATE_KEY, state);
  session.set(VERIFIER_KEY, verifier);
  session.set(RETURN_KEY, window.location.hash || '#/submit');
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: OAUTH_SCOPE,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    allow_signup: 'true',
  });
  window.location.assign(`https://github.com/login/oauth/authorize?${params}`);
}

/**
 * Finish a sign-in if this page load is the OAuth callback. Returns null when
 * it is not, otherwise { ok, error? }. Always strips code/state from the URL.
 */
export async function completeSignIn() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return null;
  const returnHash = session.get(RETURN_KEY) || '#/submit';
  window.history.replaceState(null, '', `${redirectUri()}${returnHash}`);
  const expected = session.get(STATE_KEY);
  const verifier = session.get(VERIFIER_KEY);
  session.remove(STATE_KEY);
  session.remove(VERIFIER_KEY);
  session.remove(RETURN_KEY);
  if (error) return { ok: false, error: error === 'access_denied' ? '你取消了授权。' : `GitHub 返回：${error}` };
  if (!expected || params.get('state') !== expected) {
    return { ok: false, error: '登录状态校验失败（state 不匹配），请重新登录。' };
  }
  try {
    const response = await fetch(`${AUTH_WORKER_URL}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, ...(verifier ? { code_verifier: verifier } : {}) }),
    });
    const data = await response.json();
    if (!response.ok || typeof data.access_token !== 'string') {
      return { ok: false, error: `换取授权失败：${data.error ?? response.status}` };
    }
    session.set(TOKEN_KEY, data.access_token);
    return { ok: true };
  } catch {
    return { ok: false, error: '连不上登录服务，请稍后重试。' };
  }
}
