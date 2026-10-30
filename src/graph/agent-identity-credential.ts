// Entra Agent ID autonomous-agent (S2S) token acquisition.
//
// Two hops, per https://learn.microsoft.com/entra/agent-id/autonomous-agent-authentication-authorization-flow:
//   1. The blueprint authenticates (secret, certificate or managed identity) and asks for an
//      exchange token for api://AzureADTokenExchange with fmi_path = the agent identity.
//   2. The agent identity presents that token as its client assertion and gets an app-only
//      token for the resource.
// MSAL for Node doesn't support fmi_path yet, so both hops are raw calls to the v2 token endpoint.

import { createHash, createPrivateKey, randomUUID, sign, X509Certificate, KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AccessToken, GetTokenOptions, ManagedIdentityCredential, TokenCredential } from '@azure/identity';

const EXCHANGE_SCOPE = 'api://AzureADTokenExchange/.default';
const JWT_BEARER = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
/** Refresh cached tokens this long before they expire. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type BlueprintCredential =
  | { kind: 'secret'; clientSecret: string }
  | { kind: 'certificate'; certificatePath: string }
  // `credential` is injectable for tests; otherwise a ManagedIdentityCredential is created.
  | { kind: 'managedIdentity'; clientId?: string; credential?: TokenCredential };

export interface AgentIdentityCredentialOptions {
  tenantId: string;
  /** App ID of the agent identity blueprint. */
  blueprintId: string;
  /** App ID (= object ID) of the agent identity. */
  agentId: string;
  blueprint: BlueprintCredential;
  authorityHost?: string;
}

/** A token request failed. `hop` says which side of the exchange rejected it. */
export class AgentIdentityTokenError extends Error {
  constructor(public readonly hop: 'blueprint' | 'agent', message: string) {
    super(`Agent identity token (${hop === 'blueprint' ? 'hop 1, blueprint' : 'hop 2, agent identity'}) failed: ${message}`);
    this.name = 'AgentIdentityTokenError';
  }
}

interface CachedToken {
  token: string;
  expiresOnTimestamp: number;
}

export class AgentIdentityCredential implements TokenCredential {
  private readonly tokenEndpoint: string;
  private readonly cache = new Map<string, CachedToken>();
  // In-flight requests, so concurrent callers share one round-trip per scope.
  private readonly pending = new Map<string, Promise<CachedToken>>();
  private signingKey?: { key: KeyObject; x5t: string };
  private managedIdentity?: TokenCredential;

  constructor(private readonly options: AgentIdentityCredentialOptions) {
    const host = (options.authorityHost ?? 'https://login.microsoftonline.com').replace(/\/+$/, '');
    this.tokenEndpoint = `${host}/${encodeURIComponent(options.tenantId)}/oauth2/v2.0/token`;
  }

  get agentId(): string {
    return this.options.agentId;
  }

  async getToken(scopes: string | string[], _options?: GetTokenOptions): Promise<AccessToken> {
    const scope = Array.isArray(scopes) ? scopes.join(' ') : scopes;
    const t = await this.cached(`resource:${scope}`, async () => {
      const exchange = await this.cached('exchange', () => this.requestExchangeToken());
      return this.request('agent', {
        client_id: this.options.agentId,
        grant_type: 'client_credentials',
        scope,
        client_assertion_type: JWT_BEARER,
        client_assertion: exchange.token,
      });
    });
    return { token: t.token, expiresOnTimestamp: t.expiresOnTimestamp, tokenType: 'Bearer' };
  }

  private async cached(key: string, acquire: () => Promise<CachedToken>): Promise<CachedToken> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresOnTimestamp - REFRESH_MARGIN_MS > Date.now()) return hit;
    let inflight = this.pending.get(key);
    if (!inflight) {
      inflight = acquire()
        .then(t => { this.cache.set(key, t); return t; })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, inflight);
    }
    return inflight;
  }

  private async requestExchangeToken(): Promise<CachedToken> {
    return this.request('blueprint', {
      client_id: this.options.blueprintId,
      grant_type: 'client_credentials',
      scope: EXCHANGE_SCOPE,
      fmi_path: this.options.agentId,
      ...(await this.blueprintClientAuth()),
    });
  }

  private async blueprintClientAuth(): Promise<Record<string, string>> {
    const bp = this.options.blueprint;
    switch (bp.kind) {
      case 'secret':
        return { client_secret: bp.clientSecret };
      case 'certificate':
        return { client_assertion_type: JWT_BEARER, client_assertion: this.signedAssertion(bp.certificatePath) };
      case 'managedIdentity': {
        // The blueprint is federated to the managed identity, whose exchange token is the assertion.
        this.managedIdentity ??= bp.credential ?? new ManagedIdentityCredential(bp.clientId ? { clientId: bp.clientId } : {});
        let mi: AccessToken | null;
        try {
          mi = await this.managedIdentity.getToken(EXCHANGE_SCOPE);
        } catch (err) {
          throw new AgentIdentityTokenError('blueprint', `managed identity: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!mi) throw new AgentIdentityTokenError('blueprint', 'managed identity returned no token');
        return { client_assertion_type: JWT_BEARER, client_assertion: mi.token };
      }
    }
  }

  /** RS256 client assertion signed with the blueprint certificate's private key. */
  private signedAssertion(certificatePath: string): string {
    if (!this.signingKey) {
      let pem: string;
      try {
        pem = readFileSync(certificatePath, 'utf-8');
      } catch (err) {
        throw new AgentIdentityTokenError('blueprint', `cannot read certificate: ${err instanceof Error ? err.message : String(err)}`);
      }
      const certPem = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
      const keyPem = pem.match(/-----BEGIN (?:RSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |ENCRYPTED )?PRIVATE KEY-----/)?.[0];
      if (!certPem || !keyPem) {
        throw new AgentIdentityTokenError('blueprint', 'certificate PEM must contain both a certificate and a private key');
      }
      try {
        const der = new X509Certificate(certPem).raw;
        this.signingKey = {
          key: createPrivateKey(keyPem),
          x5t: createHash('sha1').update(der).digest('base64url'),
        };
      } catch (err) {
        throw new AgentIdentityTokenError('blueprint', `invalid certificate: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', x5t: this.signingKey.x5t };
    const payload = {
      aud: this.tokenEndpoint,
      iss: this.options.blueprintId,
      sub: this.options.blueprintId,
      jti: randomUUID(),
      nbf: now,
      iat: now,
      exp: now + 600,
    };
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = `${enc(header)}.${enc(payload)}`;
    return `${data}.${sign('sha256', Buffer.from(data), this.signingKey.key).toString('base64url')}`;
  }

  private async request(hop: 'blueprint' | 'agent', params: Record<string, string>): Promise<CachedToken> {
    let res: Response;
    try {
      res = await fetch(this.tokenEndpoint, { method: 'POST', body: new URLSearchParams(params) });
    } catch (err) {
      throw new AgentIdentityTokenError(hop, err instanceof Error ? err.message : String(err));
    }
    const body = await res.json().catch(() => ({})) as {
      access_token?: string; expires_in?: number; error?: string; error_description?: string;
    };
    if (!res.ok || !body.access_token) {
      // error_description starts with the AADSTS code and never echoes the secret.
      const detail = body.error_description?.split(/\r?\n/)[0] ?? body.error ?? `HTTP ${res.status}`;
      throw new AgentIdentityTokenError(hop, detail);
    }
    return {
      token: body.access_token,
      expiresOnTimestamp: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
  }
}
