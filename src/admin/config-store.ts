import { join, resolve, sep, basename } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  graphConfig, agentCredentialTypeFromEnv, AGENT_CREDENTIAL_TYPES, AgentCredentialType,
} from '../helpers/graph-config.helper.js';
import { atomicWriteJson, safeReadJson } from '../helpers/file.helper.js';
import { resetGraphClient } from '../graph/graph-client.js';

export interface AppConfig {
  graphClientId: string;
  graphTenantId: string;
  graphClientSecret: string;
  graphCertificatePath: string;
  graphCertificatePassword: string;
  graphSendCertificateChain: boolean;
  /** Agent 365 agent identity; blank tenant falls back to graphTenantId. */
  agentTenantId: string;
  agentBlueprintId: string;
  agentId: string;
  agentName: string;
  agentCredentialType: AgentCredentialType;
  agentClientSecret: string;
  agentCertificatePath: string;
  agentManagedIdentityClientId: string;
  /** OpenRouter API key used to generate random mail text; blank falls back to GUIDs. */
  openRouterApiKey: string;
  /** OpenRouter model id used for that text generation. */
  openRouterModel: string;
  port: number;
  logPath: string;
}

function getDataDirInternal(): string {
  // Tests inject M365MUTATOR_DATA_DIR; otherwise use /data (container) or ~/.m365mutator-data (local).
  // Mode 0o700 + the config file's 0o600 (see atomicWriteJson) are the only protection on the
  // stored Graph secrets — there is no admin password to derive an encryption key from.
  if (process.env.M365MUTATOR_DATA_DIR) {
    mkdirSync(process.env.M365MUTATOR_DATA_DIR, { recursive: true, mode: 0o700 });
    return process.env.M365MUTATOR_DATA_DIR;
  }
  try {
    mkdirSync('/data', { recursive: true, mode: 0o700 });
    return '/data';
  } catch {
    const dir = join(homedir(), '.m365mutator-data');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }
}

function getConfigPath(): string {
  return join(getDataDirInternal(), 'config.json');
}

export function loadConfig(): AppConfig {
  const defaults: AppConfig = {
    graphClientId: process.env.GRAPH_CLIENT_ID || '',
    graphTenantId: process.env.GRAPH_TENANT_ID || '',
    graphClientSecret: process.env.GRAPH_CLIENT_SECRET || '',
    graphCertificatePath: process.env.GRAPH_CERTIFICATE_PATH || '',
    graphCertificatePassword: process.env.GRAPH_CERTIFICATE_PASSWORD || '',
    graphSendCertificateChain: process.env.GRAPH_SEND_CERTIFICATE_CHAIN === 'true',
    agentTenantId: process.env.AGENT365_TENANT_ID || '',
    agentBlueprintId: process.env.AGENT365_BLUEPRINT_ID || '',
    agentId: process.env.AGENT365_AGENT_ID || '',
    agentName: process.env.AGENT365_AGENT_NAME || '',
    agentCredentialType: agentCredentialTypeFromEnv(),
    agentClientSecret: process.env.AGENT365_CLIENT_SECRET || '',
    agentCertificatePath: process.env.AGENT365_CERTIFICATE_PATH || '',
    agentManagedIdentityClientId: process.env.AGENT365_MANAGED_IDENTITY_CLIENT_ID || '',
    openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
    openRouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
    port: parseInt(process.env.PORT || '3700', 10),
    logPath: process.env.M365MUTATOR_LOG_PATH || './m365mutator.log',
  };

  const saved = safeReadJson<Partial<AppConfig>>(getConfigPath(), {});
  if (Object.keys(saved).length === 0) {
    return defaults;
  }

  const merged: AppConfig = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof AppConfig)[]) {
    const savedValue = saved[key];
    const defaultValue = defaults[key];
    if (typeof defaultValue === 'number') {
      if (typeof savedValue === 'number') {
        (merged as unknown as Record<string, unknown>)[key] = savedValue;
      }
    } else if (typeof defaultValue === 'boolean') {
      if (typeof savedValue === 'boolean') {
        (merged as unknown as Record<string, unknown>)[key] = savedValue;
      }
    } else {
      if (typeof savedValue === 'string' && savedValue !== '') {
        (merged as unknown as Record<string, unknown>)[key] = savedValue;
      }
    }
  }

  if (!isAgentCredentialType(merged.agentCredentialType)) {
    merged.agentCredentialType = defaults.agentCredentialType;
  }
  return merged;
}

export function isAgentCredentialType(value: unknown): value is AgentCredentialType {
  return AGENT_CREDENTIAL_TYPES.includes(value as AgentCredentialType);
}

export function saveConfig(config: AppConfig): void {
  atomicWriteJson(getConfigPath(), config);
}

export function maskSecrets(config: AppConfig): AppConfig {
  return {
    ...config,
    graphClientSecret: config.graphClientSecret === '' ? '' : '********',
    graphCertificatePassword: config.graphCertificatePassword === '' ? '' : '********',
    openRouterApiKey: config.openRouterApiKey === '' ? '' : '********',
    graphCertificatePath: config.graphCertificatePath === '' ? '' : basename(config.graphCertificatePath),
    agentClientSecret: config.agentClientSecret === '' ? '' : '********',
    agentCertificatePath: config.agentCertificatePath === '' ? '' : basename(config.agentCertificatePath),
  };
}

/**
 * Validate and resolve a certificate path supplied by the client.
 * Accepts either a bare filename (resolved into the data directory) or an
 * absolute path that must already sit inside the data directory.
 * Throws if the resolved path would escape the data directory.
 */
export function sanitizeCertPath(inputPath: string): string {
  if (!inputPath) return '';
  const dataDir = resolve(getDataDirInternal());
  // Bare filename — resolve into the data directory
  if (!inputPath.includes('/') && !inputPath.includes('\\')) {
    return join(dataDir, inputPath);
  }
  // Absolute path must stay within the data directory
  const resolved = resolve(inputPath);
  if (resolved === dataDir || resolved.startsWith(dataDir + sep)) {
    return resolved;
  }
  throw new Error('Certificate path must be a filename or reside within the application data directory');
}

export function applyConfig(config: AppConfig): void {
  graphConfig.graphClientId = config.graphClientId;
  graphConfig.graphTenantId = config.graphTenantId;
  graphConfig.graphClientSecret = config.graphClientSecret;
  graphConfig.graphCertificatePath = config.graphCertificatePath;
  graphConfig.graphCertificatePassword = config.graphCertificatePassword;
  graphConfig.graphSendCertificateChain = config.graphSendCertificateChain;
  graphConfig.agentTenantId = config.agentTenantId;
  graphConfig.agentBlueprintId = config.agentBlueprintId;
  graphConfig.agentId = config.agentId;
  graphConfig.agentName = config.agentName;
  graphConfig.agentCredentialType = config.agentCredentialType;
  graphConfig.agentClientSecret = config.agentClientSecret;
  graphConfig.agentCertificatePath = config.agentCertificatePath;
  graphConfig.agentManagedIdentityClientId = config.agentManagedIdentityClientId;
  resetGraphClient();
}

export function getDataDir(): string {
  return getDataDirInternal();
}
