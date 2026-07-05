// Microsoft Graph configuration accessors.
// Each getter reads graphConfig, which is populated from process.env at
// startup and can be overwritten at runtime via the admin UI / config.json.

import { graphConfig } from '../helpers/graph-config.helper.js';

export function getGraphClientId(): string {
  const clientId = graphConfig.graphClientId;
  if (!clientId) {
    throw new Error('GRAPH_CLIENT_ID is required');
  }
  return clientId;
}

export function getGraphTenantId(): string {
  const tenantId = graphConfig.graphTenantId;
  if (!tenantId) {
    throw new Error('GRAPH_TENANT_ID is required');
  }
  return tenantId;
}

export function getGraphClientSecret(): string {
  return graphConfig.graphClientSecret;
}

export function getGraphCertificatePath(): string {
  return graphConfig.graphCertificatePath;
}

export function getGraphCertificatePassword(): string {
  return graphConfig.graphCertificatePassword;
}

export function getGraphSendCertificateChain(): boolean {
  return graphConfig.graphSendCertificateChain;
}

export type GraphAuthMode = 'certificate' | 'client_secret';

export function getGraphAuthMode(): GraphAuthMode {
  if (getGraphCertificatePath()) return 'certificate';
  return 'client_secret';
}

export function getDefaultGraphApiVersion(): 'v1.0' | 'beta' {
  return process.env.USE_GRAPH_BETA === 'true' ? 'beta' : 'v1.0';
}
