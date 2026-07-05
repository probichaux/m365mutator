// Runtime Graph configuration. Each field defaults from the environment at
// startup, then admin-routes.ts can overwrite it from the admin UI / config.json.
export const graphConfig: {
  graphClientId: string;
  graphTenantId: string;
  graphClientSecret: string;
  graphCertificatePath: string;
  graphCertificatePassword: string;
  graphSendCertificateChain: boolean;
} = {
  graphClientId: process.env.GRAPH_CLIENT_ID || '',
  graphTenantId: process.env.GRAPH_TENANT_ID || '',
  graphClientSecret: process.env.GRAPH_CLIENT_SECRET || '',
  graphCertificatePath: process.env.GRAPH_CERTIFICATE_PATH || '',
  graphCertificatePassword: process.env.GRAPH_CERTIFICATE_PASSWORD || '',
  graphSendCertificateChain: process.env.GRAPH_SEND_CERTIFICATE_CHAIN === 'true',
};
