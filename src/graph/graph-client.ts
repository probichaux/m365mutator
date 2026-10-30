import { AsyncLocalStorage } from 'node:async_hooks';
import { Client } from '@microsoft/microsoft-graph-client';
import { GraphAuthManager, TokenCredentialAuthProvider, createAgentIdentityCredential } from './graph-auth.js';
import { getDefaultGraphApiVersion } from './constants.js';

/**
 * Which identity a Graph call runs as: the classic app registration ('app') or
 * the Agent 365 agent identity ('agent'). Exchange and SharePoint don't accept
 * agent identity tokens yet, so workloads pick per call site (plan Decision 6).
 */
export type GraphCredential = 'app' | 'agent';

const cachedClients = new Map<GraphCredential, Client>();
const credentialScope = new AsyncLocalStorage<GraphCredential>();

/**
 * Run `fn` with every getGraphClient() call inside it (including async
 * continuations) bound to `credential`.
 */
export function withGraphCredential<T>(credential: GraphCredential, fn: () => Promise<T>): Promise<T> {
  return credentialScope.run(credential, fn);
}

/** The credential getGraphClient() uses here: the enclosing withGraphCredential scope, else 'app'. */
export function currentGraphCredential(): GraphCredential {
  return credentialScope.getStore() ?? 'app';
}

/**
 * Returns a shared, app-only authenticated Graph client for the current
 * credential (or the one given). Cached per credential, since token
 * acquisition/refresh is handled by the underlying credential.
 */
export function getGraphClient(credential: GraphCredential = currentGraphCredential()): Client {
  let client = cachedClients.get(credential);
  if (!client) {
    const authProvider = credential === 'agent'
      ? new TokenCredentialAuthProvider(createAgentIdentityCredential())
      : new GraphAuthManager().getGraphAuthProvider();
    client = Client.initWithMiddleware({ authProvider, defaultVersion: getDefaultGraphApiVersion() });
    cachedClients.set(credential, client);
  }
  return client;
}

/** Drop the cached clients — call after Graph credentials change via the admin UI. */
export function resetGraphClient(): void {
  cachedClients.clear();
}
