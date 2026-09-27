import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import worker from './src/index.js';

const env = {
  ALLOWED_ORIGIN: 'https://mimimaster.github.io',
  GITHUB_CLIENT_ID: 'client-id',
  GITHUB_CLIENT_SECRET: 'client-secret',
};
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function post(body, origin = env.ALLOWED_ORIGIN) {
  return new Request('https://auth.example/token', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('token exchange worker', () => {
  it('exchanges a code with the secret and returns only the token fields', async () => {
    let sent;
    globalThis.fetch = async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return Response.json({ access_token: 'gho_x', scope: 'public_repo', token_type: 'bearer', extra: 'dropped' });
    };
    const response = await worker.fetch(post({ code: 'abcdef123456', code_verifier: 'v'.repeat(43) }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), env.ALLOWED_ORIGIN);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { access_token: 'gho_x', scope: 'public_repo', token_type: 'bearer' });
    assert.equal(sent.url, 'https://github.com/login/oauth/access_token');
    assert.equal(sent.body.client_secret, 'client-secret');
    assert.equal(sent.body.code_verifier, 'v'.repeat(43));
  });

  it('refuses other origins without calling GitHub', async () => {
    globalThis.fetch = async () => assert.fail('must not call GitHub');
    const response = await worker.fetch(post({ code: 'abcdef123456' }, 'https://evil.example'), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  it('supports comma-separated allowed origins', async () => {
    const multiEnv = { ...env, ALLOWED_ORIGIN: 'https://extension.piwinwin.com, https://mimimaster.github.io' };
    const preflight1 = await worker.fetch(
      new Request('https://auth.example/token', { method: 'OPTIONS', headers: { origin: 'https://extension.piwinwin.com' } }),
      multiEnv,
    );
    assert.equal(preflight1.status, 204);
    assert.equal(preflight1.headers.get('access-control-allow-origin'), 'https://extension.piwinwin.com');

    const preflight2 = await worker.fetch(
      new Request('https://auth.example/token', { method: 'OPTIONS', headers: { origin: 'https://mimimaster.github.io' } }),
      multiEnv,
    );
    assert.equal(preflight2.status, 204);
    assert.equal(preflight2.headers.get('access-control-allow-origin'), 'https://mimimaster.github.io');

    const preflightEvil = await worker.fetch(
      new Request('https://auth.example/token', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }),
      multiEnv,
    );
    assert.equal(preflightEvil.status, 403);
  });

  it('answers preflight and rejects malformed input', async () => {
    const preflight = await worker.fetch(
      new Request('https://auth.example/token', { method: 'OPTIONS', headers: { origin: env.ALLOWED_ORIGIN } }),
      env,
    );
    assert.equal(preflight.status, 204);
    assert.equal((await worker.fetch(post({ code: 'x' }), env)).status, 400);
    assert.equal((await worker.fetch(post({ code: 'abcdef123456', code_verifier: 'short' }), env)).status, 400);
  });

  it('passes GitHub error codes through without echoing input', async () => {
    globalThis.fetch = async () => Response.json({ error: 'bad_verification_code', error_description: 'x' });
    const response = await worker.fetch(post({ code: 'abcdef123456' }), env);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'bad_verification_code' });
  });

  it('reports a missing secret instead of calling GitHub', async () => {
    const response = await worker.fetch(post({ code: 'abcdef123456' }), { ...env, GITHUB_CLIENT_SECRET: '' });
    assert.equal(response.status, 500);
  });
});
