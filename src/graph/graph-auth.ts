// Microsoft Graph authentication for M365Mutator.
// Supports client secret and certificate-based (Entra ID app registration) authentication,
// plus the optional Agent 365 agent identity (see agent-identity-credential.ts).

import { TokenCredential, ClientSecretCredential, ClientCertificateCredential } from '@azure/identity';
import { AuthenticationProvider } from '@microsoft/microsoft-graph-client';
import { logger } from '../logger/logger.js';
import { graphConfig } from '../helpers/graph-config.helper.js';
import { AgentIdentityCredential, BlueprintCredential } from './agent-identity-credential.js';
import {
  getGraphClientId,
  getGraphTenantId,
  getGraphClientSecret,
  getGraphCertificatePath,
  getGraphCertificatePassword,
  getGraphSendCertificateChain,
  getGraphAuthMode,
  GraphAuthMode,
} from './constants.js';

// Adapts an Azure Identity TokenCredential to the Graph SDK's AuthenticationProvider interface.
export class TokenCredentialAuthProvider implements AuthenticationProvider {
  private credential: TokenCredential;

  constructor(credential: TokenCredential) {
    this.credential = credential;
  }

  async getAccessToken(): Promise<string> {
    const token = await this.credential.getToken('https://graph.microsoft.com/.default');
    if (!token) {
      throw new Error('Failed to acquire access token');
    }
    return token.token;
  }
}

export class GraphAuthManager {
  private credential: TokenCredential;
  private authMode: GraphAuthMode;

  constructor() {
    const tenantId = getGraphTenantId();
    const clientId = getGraphClientId();
    this.authMode = getGraphAuthMode();

    if (this.authMode === 'certificate') {
      const certPath = getGraphCertificatePath();
      const certPassword = getGraphCertificatePassword();
      const sendChain = getGraphSendCertificateChain();

      logger.info(`Initializing Graph certificate-based authentication (cert: ${certPath})`);

      const certConfig: { certificatePath: string; certificatePassword?: string } = {
        certificatePath: certPath,
      };
      if (certPassword) {
        certConfig.certificatePassword = certPassword;
      }

      this.credential = new ClientCertificateCredential(
        tenantId,
        clientId,
        certConfig,
        sendChain ? { sendCertificateChain: true } : undefined,
      );
    } else {
      const clientSecret = getGraphClientSecret();
      if (!clientSecret) {
        throw new Error('GRAPH_CLIENT_SECRET is required when not using certificate authentication');
      }
      logger.info('Initializing Graph client secret authentication');
      this.credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    }
  }

  async initialize(): Promise<void> {
    try {
      const token = await this.credential.getToken('https://graph.microsoft.com/.default');
      if (!token) {
        throw new Error('Failed to acquire Graph API token');
      }
      logger.info(`Graph authentication successful (mode: ${this.authMode})`);
    } catch (error) {
      logger.error('Graph authentication test failed', error);
      throw error;
    }
  }

  getGraphAuthProvider(): TokenCredentialAuthProvider {
    return new TokenCredentialAuthProvider(this.credential);
  }

  getCredential(): TokenCredential {
    return this.credential;
  }

  getAuthMode(): GraphAuthMode {
    return this.authMode;
  }
}

type AgentConfig = Pick<typeof graphConfig,
  'graphTenantId' | 'agentTenantId' | 'agentBlueprintId' | 'agentId' | 'agentCredentialType'
  | 'agentClientSecret' | 'agentCertificatePath' | 'agentManagedIdentityClientId'>;

/** Why the agent identity can't be used, or null when it's fully configured. */
export function agentIdentityConfigError(cfg: AgentConfig = graphConfig): string | null {
  if (!(cfg.agentTenantId || cfg.graphTenantId)) return 'AGENT365_TENANT_ID (or GRAPH_TENANT_ID) is required';
  if (!cfg.agentBlueprintId) return 'AGENT365_BLUEPRINT_ID is required';
  if (!cfg.agentId) return 'AGENT365_AGENT_ID is required';
  if (cfg.agentCredentialType === 'secret' && !cfg.agentClientSecret) {
    return 'AGENT365_CLIENT_SECRET is required for the client secret blueprint credential';
  }
  if (cfg.agentCredentialType === 'certificate' && !cfg.agentCertificatePath) {
    return 'AGENT365_CERTIFICATE_PATH is required for the certificate blueprint credential';
  }
  return null;
}

/** Build the agent identity credential from the runtime config. Throws when it's incomplete. */
export function createAgentIdentityCredential(cfg: AgentConfig = graphConfig): AgentIdentityCredential {
  const problem = agentIdentityConfigError(cfg);
  if (problem) throw new Error(problem);
  let blueprint: BlueprintCredential;
  switch (cfg.agentCredentialType) {
    case 'managedIdentity':
      blueprint = { kind: 'managedIdentity', clientId: cfg.agentManagedIdentityClientId || undefined };
      break;
    case 'certificate':
      blueprint = { kind: 'certificate', certificatePath: cfg.agentCertificatePath };
      break;
    default:
      blueprint = { kind: 'secret', clientSecret: cfg.agentClientSecret };
  }
  return new AgentIdentityCredential({
    tenantId: cfg.agentTenantId || cfg.graphTenantId,
    blueprintId: cfg.agentBlueprintId,
    agentId: cfg.agentId,
    blueprint,
  });
}
