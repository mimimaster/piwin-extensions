// Which GitHub repository this site belongs to. On <owner>.github.io/<repo>/
// it is derived from the URL, so a fork of the registry works unchanged.
const DEFAULT_REPO = 'mimimaster/piwin-extensions';

export const BRANCH = 'main';

/** GitHub rejects very long URLs; past this the site falls back to copy + open. */
export const MAX_PREFILL_URL_LENGTH = 7000;

export function registryRepo(location = window.location) {
  const host = location.hostname.toLowerCase();
  const firstSegment = location.pathname.split('/').filter(Boolean)[0];
  if (host.endsWith('.github.io') && firstSegment) {
    return `${host.slice(0, -'.github.io'.length)}/${firstSegment}`;
  }
  return DEFAULT_REPO;
}

/**
 * GitHub sign-in for one-click publishing (ADR 0077 §5). Empty values keep
 * sign-in off and the site falls back to the new-file link flow.
 */
export const OAUTH_CLIENT_ID = 'Ov23likdELi0Lkra7z00';
/** Cloudflare Worker that exchanges the OAuth code (worker/). */
export const AUTH_WORKER_URL = 'https://piwin-extensions-auth.jiale18219.workers.dev';
/** Create the author's repository, fork the registry, open the PR. */
export const OAUTH_SCOPE = 'public_repo';

export function signInConfigured() {
  return Boolean(OAUTH_CLIENT_ID && AUTH_WORKER_URL);
}
