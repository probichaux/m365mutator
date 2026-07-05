// Microsoft Graph authentication for M365Mutator.
// Supports client secret and certificate-based (Entra ID app registration) authentication.

import { TokenCredential, ClientSecretCredential, ClientCertificateCredential } from '@azure/identity';
import { AuthenticationProvider } from '@microsoft/microsoft-graph-client';
import { logger } from '../logger/logger.js';
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
