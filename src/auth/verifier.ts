import type { AuthInfo, OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { OAuthError } from '@modelcontextprotocol/server';
import type { Env } from '../env';
import { hmacHex } from '../lib/crypto';

/**
 * Access tokens are opaque and random. Only an HMAC of the token is stored, so
 * a database leak does not hand an attacker usable credentials.
 *
 * `resource` is the RFC 8707 audience the token was minted for. Returning it
 * lets the SDK reject a token issued for a different resource server.
 */
export class D1TokenVerifier implements OAuthTokenVerifier {
  constructor(private readonly env: Env) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!this.env.TOKEN_SIGNING_KEY) {
      throw new OAuthError('server_error', 'Serwer nie ma skonfigurowanego klucza podpisu.');
    }
    if (typeof token !== 'string' || token.length < 20 || token.length > 512) {
      throw new OAuthError('invalid_token', 'Nieprawidłowy token dostępu.');
    }

    const hash = await hmacHex(this.env.TOKEN_SIGNING_KEY, `token:${token}`);
    const row = await this.env.DB.prepare(
      `SELECT client_id, user_id, scope, resource, expires_at, revoked_at
         FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'`,
    )
      .bind(hash)
      .first<{
        client_id: string;
        user_id: string;
        scope: string;
        resource: string;
        expires_at: string;
        revoked_at: string | null;
      }>();

    if (!row || row.revoked_at !== null) {
      throw new OAuthError('invalid_token', 'Token dostępu jest nieprawidłowy lub został unieważniony.');
    }
    const expiresAtMs = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      throw new OAuthError('invalid_token', 'Token dostępu wygasł.');
    }

    return {
      token,
      clientId: row.client_id,
      scopes: row.scope.split(' ').filter(Boolean),
      expiresAt: Math.floor(expiresAtMs / 1000),
      resource: new URL(row.resource),
      extra: { userId: row.user_id },
    };
  }
}

/** Extracts the account id an `AuthInfo` was issued for. */
export function userIdFromAuth(auth: AuthInfo | undefined): string | null {
  const value = auth?.extra?.userId;
  return typeof value === 'string' ? value : null;
}
