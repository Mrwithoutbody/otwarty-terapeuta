import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { hmacHex, toBase64Url } from '../src/lib/crypto';

const REDIRECT_URI = 'https://chatgpt.com/connector/oauth/test';
const VERIFIER = 'anonymous-catalog-verifier-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

async function registerClient(): Promise<string> {
  const response = await SELF.fetch('http://localhost/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT test', redirect_uris: [REDIRECT_URI] }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id: string };
  return body.client_id;
}

function authorizeParams(clientId: string, challenge: string): URLSearchParams {
  return new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'catalog:read booking:read booking:write',
    state: 'state-test',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: env.PUBLIC_MCP_URL,
  });
}

describe('deferred OAuth sign-in', () => {
  it('offers anonymous catalogue access before the e-mail form', async () => {
    const clientId = await registerClient();
    const query = authorizeParams(clientId, await challengeFor(VERIFIER));
    const response = await SELF.fetch(`http://localhost/oauth/authorize?${query}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Korzystaj bez konta');
    expect(html).toContain('Logowanie pojawi się dopiero');
    expect(html.indexOf('Korzystaj bez konta')).toBeLessThan(html.indexOf('Adres e-mail'));
  });

  it('allows the client redirect origin in form-action', async () => {
    // Regression: `form-action 'self'` blocked the consent form outright, because
    // browsers apply the directive to the whole redirect chain and our POST ends in
    // a 302 to the client. Chrome even names OUR url in the error, which hides it.
    const clientId = await registerClient();
    const query = authorizeParams(clientId, await challengeFor(VERIFIER));
    const res = await SELF.fetch(`http://localhost/oauth/authorize?${query}`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain(`form-action 'self' ${new URL(REDIRECT_URI).origin}`);
  });

  it('round-trips every parameter the consent form needs', async () => {
    // Regression: the hidden fields once dropped `code_challenge_method`, and each
    // POST on the consent screens re-parses the request - so every button on the
    // page died with "Wymagane jest PKCE z metodą S256." Submit exactly what the
    // rendered HTML carries, not a hand-built form, or the gap stays invisible.
    const clientId = await registerClient();
    const query = authorizeParams(clientId, await challengeFor(VERIFIER));
    const html = await (await SELF.fetch(`http://localhost/oauth/authorize?${query}`)).text();

    const hidden = new URLSearchParams();
    for (const match of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
      hidden.set(match[1] ?? '', match[2] ?? '');
    }
    expect(hidden.get('code_challenge_method')).toBe('S256');

    const authorize = await SELF.fetch('http://localhost/oauth/authorize/anonymous', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: hidden.toString(),
      redirect: 'manual',
    });
    expect(authorize.status).toBe(302);
  });

  it('down-scopes the anonymous grant to catalog:read', async () => {
    const clientId = await registerClient();
    const form = authorizeParams(clientId, await challengeFor(VERIFIER));
    const authorize = await SELF.fetch('http://localhost/oauth/authorize/anonymous', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    });

    expect(authorize.status).toBe(302);
    const callback = new URL(authorize.headers.get('location')!);
    expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
    expect(callback.searchParams.get('state')).toBe('state-test');
    const code = callback.searchParams.get('code');
    expect(code).toBeTruthy();

    const token = await SELF.fetch('http://localhost/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: code!,
        code_verifier: VERIFIER,
        redirect_uri: REDIRECT_URI,
        resource: env.PUBLIC_MCP_URL,
      }).toString(),
    });
    expect(token.status).toBe(200);
    const body = (await token.json()) as { access_token: string; scope: string };
    expect(body.scope).toBe('catalog:read');

    const stored = await env.DB.prepare(
      `SELECT t.scope, u.email_hash, u.email_enc
         FROM oauth_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.kind = 'access'`,
    )
      .bind(await hmacHex(env.TOKEN_SIGNING_KEY!, `token:${body.access_token}`))
      .first<{ scope: string; email_hash: string; email_enc: string }>();
    expect(stored?.scope).toBe('catalog:read');
    expect(stored?.email_hash).toMatch(/^anonymous:usr_/);
    expect(stored?.email_enc).toBe('');
  });
});
