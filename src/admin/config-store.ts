import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { graphConfig } from '../helpers/graph-config.helper.js';
import { atomicWriteJson, safeReadJson } from '../helpers/file.helper.js';
import { resetGraphClient } from '../graph/graph-client.js';

export interface AppConfig {
  graphClientId: string;
  graphTenantId: string;
  graphClientSecret: string;
  graphCertificatePath: string;
  graphCertificatePassword: string;
  graphSendCertificateChain: boolean;
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

  return merged;
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
  };
}

export function applyConfig(config: AppConfig): void {
  graphConfig.graphClientId = config.graphClientId;
  graphConfig.graphTenantId = config.graphTenantId;
  graphConfig.graphClientSecret = config.graphClientSecret;
  graphConfig.graphCertificatePath = config.graphCertificatePath;
  graphConfig.graphCertificatePassword = config.graphCertificatePassword;
  graphConfig.graphSendCertificateChain = config.graphSendCertificateChain;
  resetGraphClient();
}

export function getDataDir(): string {
  return getDataDirInternal();
}
