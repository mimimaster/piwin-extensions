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
