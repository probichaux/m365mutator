import { join, resolve, sep, basename } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { graphConfig } from '../helpers/graph-config.helper.js';
import { atomicWriteJson, safeReadJson } from '../helpers/file.helper.js';
import { resetGraphClient } from '../graph/graph-client.js';

/**
 * Default text-generation prompts. Used both to seed config defaults and as the
 * fallback when the user leaves a custom prompt blank. Kept here (rather than in
 * random-text.ts) so config-store has no import cycle with its consumer.
 */
export const DEFAULT_SUBJECT_PROMPT =
  'Generate a one-sentence subject line in English related to software-as-a-service applications, OR airline travel, OR the World Cup.';
export const DEFAULT_BODY_PROMPT =
  'Generate a one-paragraph text summary of a little-known scientific fact about physics, chemistry, biology, geology, or astronomy.';

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
  /** Prompt sent to the model to generate subject lines and document titles; blank falls back to the default. */
  subjectPrompt: string;
  /** Prompt sent to the model to generate message and file bodies; blank falls back to the default. */
  bodyPrompt: string;
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
    subjectPrompt: process.env.SUBJECT_PROMPT || DEFAULT_SUBJECT_PROMPT,
    bodyPrompt: process.env.BODY_PROMPT || DEFAULT_BODY_PROMPT,
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
    graphCertificatePath: config.graphCertificatePath === '' ? '' : basename(config.graphCertificatePath),
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
  resetGraphClient();
}

export function getDataDir(): string {
  return getDataDirInternal();
}
