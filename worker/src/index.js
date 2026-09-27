// OAuth code → token exchange for the registry site. That one step needs the
// OAuth App's client secret, and GitHub's token endpoint does not allow
// browser CORS, so it cannot happen in the page.
//
// It does nothing else: no storage, no logging of codes or tokens, and CORS
// answers only the configured Pages origin. CSRF `state` is generated and
// checked by the page (sessionStorage), which is the party that knows it.

const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
const CODE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? '';
    const allowed = origin === env.ALLOWED_ORIGIN;
    const cors = allowed
      ? {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
          vary: 'origin',
        }
      : { vary: 'origin' };
    const reply = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors },
      });

    const url = new URL(request.url);
    if (url.pathname !== '/token') return reply(404, { error: 'not_found' });
    if (!allowed) return reply(403, { error: 'origin_not_allowed' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return reply(500, { error: 'not_configured' });

    let input;
    try {
      const text = await request.text();
      if (text.length > 2048) return reply(413, { error: 'too_large' });
      input = JSON.parse(text);
    } catch {
      return reply(400, { error: 'invalid_json' });
    }
    if (typeof input?.code !== 'string' || !CODE_PATTERN.test(input.code)) {
      return reply(400, { error: 'invalid_code' });
    }
    if (input.code_verifier !== undefined && (typeof input.code_verifier !== 'string' || !VERIFIER_PATTERN.test(input.code_verifier))) {
      return reply(400, { error: 'invalid_verifier' });
    }

    const exchange = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: input.code,
        ...(input.code_verifier ? { code_verifier: input.code_verifier } : {}),
      }),
    });
    let result;
    try {
      result = await exchange.json();
    } catch {
      return reply(502, { error: 'bad_upstream' });
    }
    if (!exchange.ok || typeof result.access_token !== 'string') {
      // GitHub's error code only (e.g. bad_verification_code); never echo input.
      return reply(400, { error: typeof result.error === 'string' ? result.error : 'exchange_failed' });
    }
    return reply(200, { access_token: result.access_token, scope: result.scope ?? '', token_type: result.token_type ?? 'bearer' });
  },
};
