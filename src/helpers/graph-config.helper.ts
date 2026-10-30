/** How the agent identity blueprint authenticates for hop 1 of the token exchange. */
export const AGENT_CREDENTIAL_TYPES = ['secret', 'certificate', 'managedIdentity'] as const;
export type AgentCredentialType = (typeof AGENT_CREDENTIAL_TYPES)[number];

export function agentCredentialTypeFromEnv(): AgentCredentialType {
  if (process.env.AGENT365_USE_MANAGED_IDENTITY === 'true') return 'managedIdentity';
  if (process.env.AGENT365_CERTIFICATE_PATH) return 'certificate';
  return 'secret';
}

// Runtime Graph configuration. Each field defaults from the environment at
// startup, then admin-routes.ts can overwrite it from the admin UI / config.json.
export const graphConfig: {
  graphClientId: string;
  graphTenantId: string;
  graphClientSecret: string;
  graphCertificatePath: string;
  graphCertificatePassword: string;
  graphSendCertificateChain: boolean;
  // Agent 365 agent identity (Entra Agent ID). Optional; see agent-identity-credential.ts.
  agentTenantId: string;
  agentBlueprintId: string;
  agentId: string;
  agentName: string;
  agentCredentialType: AgentCredentialType;
  agentClientSecret: string;
  agentCertificatePath: string;
  agentManagedIdentityClientId: string;
} = {
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
};
