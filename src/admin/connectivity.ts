import { graphConfig } from '../helpers/graph-config.helper.js';
import { GraphAuthManager, createAgentIdentityCredential } from '../graph/graph-auth.js';
import { loadConfig, saveConfig, sanitizeCertPath, isAgentCredentialType } from './config-store.js';
import { logger } from '../logger/logger.js';

export interface ConnectivityResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  /** Call after globals are restored to permanently apply tested credentials. */
  _apply?: () => void;
}

/**
 * Sanitize an upstream error message before it is logged or returned to the
 * client. Strips Authorization headers and password/token/secret-looking
 * substrings that may have been echoed back in HTTP response bodies, and caps
 * length to keep logs and JSON responses bounded.
 */
export function sanitizeUpstreamError(raw: unknown): string {
  let msg = raw instanceof Error ? raw.message : (typeof raw === 'string' ? raw : String(raw));
  if (!msg) return 'Unknown error';
  msg = msg.replace(/Authorization:\s*\S+/gi, 'Authorization: [REDACTED]');
  msg = msg.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/g, 'Bearer [REDACTED]');
  msg = msg.replace(/(["']?(?:password|pass|secret|token|client_secret)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1[REDACTED]');
  if (msg.length > 500) msg = msg.slice(0, 500) + '…';
  return msg;
}

interface GraphTestOverrides {
  graphClientId?: string;
  graphTenantId?: string;
  graphClientSecret?: string;
  graphCertificatePath?: string;
  graphCertificatePassword?: string;
}

/**
 * Test Graph connectivity. If overrides are provided (from form values),
 * temporarily apply them to graphConfig for the duration of the test, then
 * always restore — globals are only updated permanently on success via the
 * returned _apply callback.
 */
export async function testGraph(overrides?: GraphTestOverrides): Promise<ConnectivityResult> {
  const saved = { ...graphConfig };

  if (overrides) {
    // Validate cert path before touching any globals so we can return cleanly
    if (overrides.graphCertificatePath !== undefined) {
      try {
        overrides = { ...overrides, graphCertificatePath: sanitizeCertPath(overrides.graphCertificatePath) };
      } catch (e: any) {
        return { success: false, latencyMs: 0, error: e.message };
      }
    }
    logger.info(`[CONNECTIVITY] Graph test overrides: tenantId=${overrides.graphTenantId ?? '(none)'}, clientId=${overrides.graphClientId ?? '(none)'}, secret=${overrides.graphClientSecret ? '(set)' : '(none)'}, certPath=${overrides.graphCertificatePath ?? '(none)'}`);
    if (overrides.graphClientId !== undefined) graphConfig.graphClientId = overrides.graphClientId;
    if (overrides.graphTenantId !== undefined) graphConfig.graphTenantId = overrides.graphTenantId;
    if (overrides.graphClientSecret !== undefined && overrides.graphClientSecret !== '********') {
      graphConfig.graphClientSecret = overrides.graphClientSecret;
    }
    if (overrides.graphCertificatePath !== undefined) graphConfig.graphCertificatePath = overrides.graphCertificatePath;
    if (overrides.graphCertificatePassword !== undefined && overrides.graphCertificatePassword !== '********') {
      graphConfig.graphCertificatePassword = overrides.graphCertificatePassword;
    }
  }

  const start = Date.now();
  try {
    const authManager = new GraphAuthManager();
    await authManager.initialize();
    const latencyMs = Date.now() - start;
    // Capture tested credentials before restoring globals
    const testedConfig = { ...graphConfig };
    logger.info(`[CONNECTIVITY] Graph test succeeded in ${latencyMs}ms (tenantId=${testedConfig.graphTenantId || '(unset)'}, clientId=${testedConfig.graphClientId || '(unset)'})`);
    return {
      success: true,
      latencyMs,
      _apply: () => {
        // Deferred: persist and apply only after globals are restored
        Object.assign(graphConfig, testedConfig);
        try {
          const config = loadConfig();
          Object.assign(config, testedConfig);
          saveConfig(config);
        } catch (e) {
          logger.warn('[CONNECTIVITY] Could not persist Graph credentials to config file:', e);
        }
      },
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const errorMsg = sanitizeUpstreamError(err);
    logger.warn(`[CONNECTIVITY] Graph test failed in ${latencyMs}ms: ${errorMsg}`);
    return { success: false, latencyMs, error: errorMsg };
  } finally {
    Object.assign(graphConfig, saved);
  }
}

export interface AgentTokenResult {
  success: boolean;
  latencyMs: number;
  /** Graph application roles in the agent identity's token. */
  roles?: string[];
  error?: string;
}

interface AgentTestOverrides {
  graphTenantId?: string;
  agentTenantId?: string;
  agentBlueprintId?: string;
  agentId?: string;
  agentCredentialType?: string;
  agentClientSecret?: string;
  agentCertificatePath?: string;
  agentManagedIdentityClientId?: string;
}

/**
 * Acquire a Graph token as the agent identity (both hops) using the saved
 * config overlaid with the form values. Nothing is persisted; Save does that.
 * Only the token is tested: Exchange and SharePoint reject agent identity
 * tokens today, so a successful token doesn't mean the workloads will work.
 */
export async function testAgentToken(overrides: AgentTestOverrides = {}): Promise<AgentTokenResult> {
  const cfg = { ...graphConfig };
  const str = (v: unknown): v is string => typeof v === 'string';
  for (const key of ['graphTenantId', 'agentTenantId', 'agentBlueprintId', 'agentId', 'agentManagedIdentityClientId'] as const) {
    if (str(overrides[key])) cfg[key] = overrides[key];
  }
  if (str(overrides.agentClientSecret) && overrides.agentClientSecret !== '' && overrides.agentClientSecret !== '********') {
    cfg.agentClientSecret = overrides.agentClientSecret;
  }
  if (overrides.agentCredentialType !== undefined) {
    if (!isAgentCredentialType(overrides.agentCredentialType)) {
      return { success: false, latencyMs: 0, error: 'Invalid blueprint credential type' };
    }
    cfg.agentCredentialType = overrides.agentCredentialType;
  }
  if (str(overrides.agentCertificatePath) && overrides.agentCertificatePath !== '') {
    try {
      cfg.agentCertificatePath = sanitizeCertPath(overrides.agentCertificatePath);
    } catch (e: unknown) {
      return { success: false, latencyMs: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const start = Date.now();
  try {
    const token = await createAgentIdentityCredential(cfg).getToken('https://graph.microsoft.com/.default');
    const latencyMs = Date.now() - start;
    const claims = JSON.parse(Buffer.from(token.token.split('.')[1] ?? '', 'base64url').toString('utf-8')) as { roles?: unknown };
    const roles = Array.isArray(claims.roles) ? claims.roles.filter(str).sort() : [];
    logger.info(`[CONNECTIVITY] Agent token acquired in ${latencyMs}ms (agentId=${cfg.agentId}, roles=${roles.join(',') || '(none)'})`);
    return { success: true, latencyMs, roles };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const errorMsg = sanitizeUpstreamError(err);
    logger.warn(`[CONNECTIVITY] Agent token test failed in ${latencyMs}ms: ${errorMsg}`);
    return { success: false, latencyMs, error: errorMsg };
  }
}
