import { Client } from '@microsoft/microsoft-graph-client';
import { GraphAuthManager } from './graph-auth.js';
import { getDefaultGraphApiVersion } from './constants.js';

let cachedClient: Client | null = null;

/**
 * Returns a shared, app-only authenticated Graph client. Cached across calls
 * since token acquisition/refresh is handled by the underlying credential.
 */
export function getGraphClient(): Client {
  if (!cachedClient) {
    const authManager = new GraphAuthManager();
    cachedClient = Client.initWithMiddleware({
      authProvider: authManager.getGraphAuthProvider(),
      defaultVersion: getDefaultGraphApiVersion(),
    });
  }
  return cachedClient;
}

/** Drop the cached client — call after Graph credentials change via the admin UI. */
export function resetGraphClient(): void {
  cachedClient = null;
}
