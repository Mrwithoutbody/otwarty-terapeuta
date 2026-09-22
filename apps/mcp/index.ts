import { Hono } from 'hono';
import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  oauthMetadataResponse,
  originValidationResponse,
  verifyBearerToken,
  type AuthInfo,
  type AuthMetadataOptions,
} from '@modelcontextprotocol/server';
import { ALL_SCOPES, type Env } from '../../shared/env';
import { log } from '../../shared/lib/log';
import { authorizationServerMetadata, oauthApp } from './auth/oauth';
import { D1TokenVerifier } from './auth/verifier';
import { receiptPage } from './booking/receipt';
import { createServerFactory } from './server';
import { addToolSecuritySchemes, isOAuthToolName } from './security';

// ------------------------------------------------------------------- MCP ---

function authMetadataOptions(env: Env): AuthMetadataOptions {
  return {
    oauthMetadata: authorizationServerMetadata(env) as AuthMetadataOptions['oauthMetadata'],
    resourceServerUrl: new URL(env.PUBLIC_MCP_URL),
    serviceDocumentationUrl: new URL(`${env.PUBLIC_BASE_URL}/jak-to-dziala`),
    scopesSupported: ALL_SCOPES,
    resourceName: 'Otwarty Terapeuta',
    dangerouslyAllowInsecureIssuerUrl: env.ENVIRONMENT === 'local',
  };
}

const MCP_CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers':
    'content-type, authorization, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version, www-authenticate',
  'access-control-max-age': '86400',
};

function allowedHostnames(env: Env): string[] {
  const hosts = new Set<string>(['localhost', '127.0.0.1', '[::1]']);
  for (const value of [env.PUBLIC_BASE_URL, env.PUBLIC_MCP_URL]) {
    try {
      hosts.add(new URL(value).hostname);
    } catch {
      /* a malformed var is caught by assertConfig-adjacent checks, not here */
    }
  }
  return [...hosts];
}

/**
 * Verifies a Bearer token when one is present. A missing token is NOT an
 * error: the catalogue tools are public, and the private tools answer with
 * their own `mcp/www_authenticate` challenge.
 */
async function resolveAuth(env: Env, request: Request): Promise<AuthInfo | Response | undefined> {
  const header = request.headers.get('authorization');
  if (!header) return undefined;
  try {
    return await verifyBearerToken(header, {
      verifier: new D1TokenVerifier(env),
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(env.PUBLIC_MCP_URL)),
    });
  } catch (error) {
    const response = bearerAuthChallengeResponse(error, {
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(env.PUBLIC_MCP_URL)),
    });
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  }
}

async function handleMcp(request: Request, env: Env, anonymousOnly = false): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
  }

  const rejected =
    hostHeaderValidationResponse(request, allowedHostnames(env)) ??
    originValidationResponse(request, allowedHostnames(env));
  if (rejected) return rejected;

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (!(await env.RL_PUBLIC.limit({ key: `mcp:${ip}` })).success) {
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32000, message: 'Zbyt wiele żądań. Spróbuj ponownie za chwilę.' } },
      { status: 429, headers: MCP_CORS_HEADERS },
    );
  }

  let isToolsList = false;
  let blockedCall: { id?: unknown; name: unknown } | undefined;
  if (request.method === 'POST') {
    try {
      const message = (await request.clone().json()) as {
        id?: unknown;
        method?: unknown;
        params?: { name?: unknown };
      };
      isToolsList = message.method === 'tools/list';
      if (anonymousOnly && message.method === 'tools/call' && isOAuthToolName(message.params?.name)) {
        blockedCall = { id: message.id, name: message.params?.name };
      }
    } catch {
      // The MCP handler returns the protocol-level parse error.
    }
  }

  if (blockedCall) {
    return Response.json(
      {
        jsonrpc: '2.0',
        id: blockedCall.id ?? null,
        error: {
          code: -32601,
          message: `Narzędzie ${String(blockedCall.name)} nie jest dostępne w publicznym trybie testowym.`,
        },
      },
      { status: 200, headers: MCP_CORS_HEADERS },
    );
  }

  // The public testing endpoint deliberately ignores Authorization headers.
  // That keeps it entirely outside OAuth, including when a client reuses a
  // stale header left over from a previously configured connection.
  const auth = anonymousOnly ? undefined : await resolveAuth(env, request);
  if (auth instanceof Response) return auth;

  const handler = createMcpHandler(createServerFactory(env), {
    onerror: (error) => log.error('mcp.transport_error', error),
  });

  let response = await handler.fetch(request, auth ? { authInfo: auth } : undefined);
  if (isToolsList && response.ok) {
    response = await addToolSecuritySchemes(response, { anonymousOnly });
  }
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * The protocol surface, answered before Hono ever sees the request, in this
 * exact order. `undefined` means "not mine, carry on with the apps".
 */
export async function mcpFetch(request: Request, env: Env): Promise<Response | undefined> {
  const url = new URL(request.url);

  // Do not publish fallback resource metadata at the hostname root. Clients
  // probing /public/mcp commonly fall back to this URL and would otherwise
  // misclassify the deliberately anonymous endpoint as OAuth-protected.
  // The full /mcp endpoint keeps its path-specific RFC 9728 document.
  if (url.pathname === '/.well-known/oauth-protected-resource') {
    return new Response('Not found', { status: 404 });
  }

  // RFC 9728 / RFC 8414 discovery documents, served by the SDK so the shape
  // always matches what MCP clients expect.
  const metadata = oauthMetadataResponse(request, authMetadataOptions(env));
  if (metadata) return metadata;

  if (url.pathname === '/mcp') return handleMcp(request, env);
  if (url.pathname === '/public/mcp') return handleMcp(request, env, true);

  // The MCP subdomain serves nothing but the protocol surface — plus the
  // OpenAI domain challenge, which the submission portal probes on whichever
  // host it was given (PLUGIN_SUBMISSION_CHECKLIST §11). Hono owns that route.
  if (
    url.hostname.startsWith('mcp.') &&
    url.pathname !== '/' &&
    url.pathname !== '/.well-known/openai-apps-challenge'
  ) {
    return new Response('Not found', { status: 404 });
  }

  return undefined;
}

/** The routes MCP owns inside Hono: the challenge, OAuth and the receipt page. */
export const mcpApp = new Hono<{ Bindings: Env }>();

/**
 * Domain-control proof for the OpenAI public plugin submission. The portal
 * requires the response body to contain only its exact token. Keep the route
 * unavailable until the portal has generated a token for this plugin.
 */
mcpApp.get('/.well-known/openai-apps-challenge', (c) => {
  const token = c.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response('Not found', { status: 404 });
  return new Response(token, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
});

mcpApp.route('/oauth', oauthApp);

/** Booking receipt, reached from the link in the confirmation e-mail. */
mcpApp.get('/rezerwacja/:ref', receiptPage);
