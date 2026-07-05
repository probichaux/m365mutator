import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { graphConfig } from '../helpers/graph-config.helper.js';
import { atomicWriteJson, safeReadJson } from '../helpers/file.helper.js';
import { encrypt, decrypt } from '../helpers/crypto.helper.js';
import { resetGraphClient } from '../graph/graph-client.js';
import { logger } from '../logger/logger.js';

export interface AppConfig {
  graphClientId: string;
  graphTenantId: string;
  graphClientSecret: string;
  graphCertificatePath: string;
  graphCertificatePassword: string;
  graphSendCertificateChain: boolean;
  port: number;
  logPath: string;
}

const SECRET_FIELDS = ['graphClientSecret', 'graphCertificatePassword'] as const;

type SecretField = typeof SECRET_FIELDS[number];
type EncField = `${SecretField}_enc`;

/** On-disk representation — may contain `_enc` companions for encrypted secrets. */
type StoredConfig = AppConfig & Partial<Record<EncField, string>>;

function getDataDirInternal(): string {
  // Tests inject M365MUTATOR_DATA_DIR; otherwise use /data (container) or ~/.m365mutator-data (local).
  // Mode 0o700: the directory contains the encrypted config and must not be world-readable.
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
    port: parseInt(process.env.PORT || '3700', 10),
    logPath: process.env.M365MUTATOR_LOG_PATH || './m365mutator.log',
  };

  const saved = safeReadJson<Partial<StoredConfig>>(getConfigPath(), {});
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

  // Decrypt secret fields if _enc companions exist
  const adminPassword = process.env.M365MUTATOR_ADMIN_PASSWORD;
  if (adminPassword) {
    for (const field of SECRET_FIELDS) {
      const encKey = `${field}_enc` as EncField;
      const encValue = saved[encKey];
      if (encValue) {
        try {
          (merged as unknown as Record<string, unknown>)[field] = decrypt(encValue, adminPassword);
        } catch {
          logger.warn(`[CONFIG] Could not decrypt ${field} — admin password may have changed. Re-enter via admin UI.`);
          // Don't overwrite — keep the env-var fallback already in merged[field]
        }
      }
    }
  }

  return merged;
}

export function saveConfig(config: AppConfig): void {
  const stored: StoredConfig = { ...config };
  const adminPassword = process.env.M365MUTATOR_ADMIN_PASSWORD;
  if (adminPassword) {
    for (const field of SECRET_FIELDS) {
      const plaintext = config[field];
      if (plaintext) {
        const encKey = `${field}_enc` as EncField;
        stored[encKey] = encrypt(plaintext, adminPassword);
        (stored as unknown as Record<string, unknown>)[field] = '';
      }
    }
  } else {
    // Without admin password, strip secrets from disk — never write plaintext
    const hasSecrets = SECRET_FIELDS.some(f => !!config[f]);
    if (hasSecrets) {
      logger.warn('[CONFIG] M365MUTATOR_ADMIN_PASSWORD is not set — secrets will NOT be persisted to disk. Set M365MUTATOR_ADMIN_PASSWORD to enable encrypted secret storage.');
    }
    for (const field of SECRET_FIELDS) {
      (stored as unknown as Record<string, unknown>)[field] = '';
    }
  }

  atomicWriteJson(getConfigPath(), stored);
}

export function maskSecrets(config: AppConfig): AppConfig {
  return {
    ...config,
    graphClientSecret: config.graphClientSecret === '' ? '' : '********',
    graphCertificatePassword: config.graphCertificatePassword === '' ? '' : '********',
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
