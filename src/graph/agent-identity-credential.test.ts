import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, verify, X509Certificate } from 'node:crypto';
import { AgentIdentityCredential, AgentIdentityTokenError } from './agent-identity-credential.js';
import { agentIdentityConfigError, createAgentIdentityCredential } from '../graph/graph-auth.js';

const TENANT = 'tenant-1';
const BP = 'blueprint-1';
const AGENT = 'agent-1';
const ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const GRAPH = 'https://graph.microsoft.com/.default';
const OBS = 'api://9b975845-388f-4429-889e-eab1ef63949c/.default';

type Reply = { status?: number; body: Record<string, unknown> };
let calls: Record<string, string>[];
let replies: Reply[];

function ok(token: string, expiresIn = 3600): Reply {
  return { body: { access_token: token, expires_in: expiresIn } };
}

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
    calls.push(Object.fromEntries(init.body));
    const r = replies.shift() ?? ok(`token-${calls.length}`);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function secretCredential() {
  return new AgentIdentityCredential({
    tenantId: TENANT, blueprintId: BP, agentId: AGENT, blueprint: { kind: 'secret', clientSecret: 's3cret' },
  });
}

describe('AgentIdentityCredential', () => {
  it('exchanges the blueprint token for an agent identity token', async () => {
    replies.push(ok('T1'), ok('graph-token'));
    const token = await secretCredential().getToken(GRAPH);
    expect(token.token).toBe('graph-token');
    expect(vi.mocked(fetch).mock.calls.map(c => c[0])).toEqual([ENDPOINT, ENDPOINT]);
    expect(calls).toEqual([
      {
        client_id: BP, grant_type: 'client_credentials', scope: 'api://AzureADTokenExchange/.default',
        fmi_path: AGENT, client_secret: 's3cret',
      },
      {
        client_id: AGENT, grant_type: 'client_credentials', scope: GRAPH,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: 'T1',
      },
    ]);
  });

  it('caches per resource and reuses the exchange token across resources', async () => {
    const cred = secretCredential();
    await cred.getToken(GRAPH);
    await cred.getToken([GRAPH]);
    await cred.getToken(OBS);
    expect(calls.map(c => c.scope)).toEqual(['api://AzureADTokenExchange/.default', GRAPH, OBS]);
  });

  it('refreshes tokens five minutes before they expire', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cred = secretCredential();
    await cred.getToken(GRAPH);
    vi.advanceTimersByTime(54 * 60 * 1000);
    await cred.getToken(GRAPH);
    expect(calls).toHaveLength(2);
    vi.advanceTimersByTime(2 * 60 * 1000);
    await cred.getToken(GRAPH);
    expect(calls).toHaveLength(4);
  });

  it('shares one round-trip between concurrent callers', async () => {
    const cred = secretCredential();
    const [a, b] = await Promise.all([cred.getToken(GRAPH), cred.getToken(GRAPH)]);
    expect(a.token).toBe(b.token);
    expect(calls).toHaveLength(2);
  });

  it('reports which hop failed, with only the first line of the Entra error', async () => {
    replies.push({
      status: 401,
      body: { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x' },
    });
    const err = await secretCredential().getToken(GRAPH).catch(e => e);
    expect(err).toBeInstanceOf(AgentIdentityTokenError);
    expect(err.hop).toBe('blueprint');
    expect(err.message).toContain('AADSTS7000215: Invalid client secret provided.');
    expect(err.message).not.toContain('Trace ID');

    replies.push(ok('T1'), { status: 400, body: { error: 'unauthorized_client' } });
    const err2 = await secretCredential().getToken(GRAPH).catch(e => e);
    expect(err2.hop).toBe('agent');
    expect(err2.message).toContain('unauthorized_client');
  });

  it('does not cache failures', async () => {
    const cred = secretCredential();
    replies.push({ status: 500, body: {} });
    await expect(cred.getToken(GRAPH)).rejects.toThrow('HTTP 500');
    await expect(cred.getToken(GRAPH)).resolves.toBeTruthy();
  });

  it('uses the managed identity token as the blueprint assertion', async () => {
    const mi = { getToken: vi.fn(async () => ({ token: 'mi-token', expiresOnTimestamp: Date.now() + 3600_000 })) };
    const cred = new AgentIdentityCredential({
      tenantId: TENANT, blueprintId: BP, agentId: AGENT, blueprint: { kind: 'managedIdentity', credential: mi },
    });
    await cred.getToken(GRAPH);
    expect(mi.getToken).toHaveBeenCalledWith('api://AzureADTokenExchange/.default');
    expect(calls[0]).toMatchObject({ client_assertion: 'mi-token', fmi_path: AGENT });
    expect(calls[0]).not.toHaveProperty('client_secret');
  });

  describe('certificate', () => {
    let dir: string;
    let pemPath: string;
    let hasOpenssl = true;
    try {
      execFileSync('openssl', ['version'], { stdio: 'ignore' });
    } catch {
      hasOpenssl = false;
    }

    beforeEach(() => {
      if (!hasOpenssl) return;
      dir = mkdtempSync(join(tmpdir(), 'agent-cert-'));
      const key = join(dir, 'key.pem');
      const crt = join(dir, 'cert.pem');
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt,
        '-subj', '/CN=m365mutator-test', '-days', '1'], { stdio: 'ignore' });
      pemPath = join(dir, 'combined.pem');
      writeFileSync(pemPath, readFileSync(crt, 'utf-8') + readFileSync(key, 'utf-8'));
    });

    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it.skipIf(!hasOpenssl)('signs an RS256 client assertion with the certificate thumbprint', async () => {
      const cred = new AgentIdentityCredential({
        tenantId: TENANT, blueprintId: BP, agentId: AGENT, blueprint: { kind: 'certificate', certificatePath: pemPath },
      });
      await cred.getToken(GRAPH);
      const assertion = calls[0].client_assertion;
      const [h, p, sig] = assertion.split('.');
      const header = JSON.parse(Buffer.from(h, 'base64url').toString());
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
      const cert = new X509Certificate(readFileSync(pemPath, 'utf-8'));
      expect(header).toEqual({ alg: 'RS256', typ: 'JWT', x5t: createHash('sha1').update(cert.raw).digest('base64url') });
      expect(payload).toMatchObject({ aud: ENDPOINT, iss: BP, sub: BP });
      expect(payload.exp - payload.nbf).toBe(600);
      expect(verify('sha256', Buffer.from(`${h}.${p}`), cert.publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
    });

    it('rejects a PEM without a private key', async () => {
      const bad = join(mkdtempSync(join(tmpdir(), 'agent-cert-')), 'bad.pem');
      writeFileSync(bad, '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n');
      const cred = new AgentIdentityCredential({
        tenantId: TENANT, blueprintId: BP, agentId: AGENT, blueprint: { kind: 'certificate', certificatePath: bad },
      });
      await expect(cred.getToken(GRAPH)).rejects.toThrow('both a certificate and a private key');
      expect(calls).toHaveLength(0);
    });
  });
});

describe('agent identity config', () => {
  const base = {
    graphTenantId: 'g-tenant', agentTenantId: '', agentBlueprintId: BP, agentId: AGENT,
    agentCredentialType: 'secret' as const, agentClientSecret: 's', agentCertificatePath: '', agentManagedIdentityClientId: '',
  };

  it('names the first missing setting', () => {
    expect(agentIdentityConfigError(base)).toBeNull();
    expect(agentIdentityConfigError({ ...base, agentBlueprintId: '' })).toMatch('AGENT365_BLUEPRINT_ID');
    expect(agentIdentityConfigError({ ...base, agentId: '' })).toMatch('AGENT365_AGENT_ID');
    expect(agentIdentityConfigError({ ...base, agentClientSecret: '' })).toMatch('AGENT365_CLIENT_SECRET');
    expect(agentIdentityConfigError({ ...base, agentCredentialType: 'certificate' })).toMatch('AGENT365_CERTIFICATE_PATH');
    expect(agentIdentityConfigError({ ...base, agentCredentialType: 'managedIdentity', agentClientSecret: '' })).toBeNull();
  });

  it('falls back to the Graph tenant', async () => {
    await createAgentIdentityCredential(base).getToken(GRAPH);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://login.microsoftonline.com/g-tenant/oauth2/v2.0/token');
  });
});
