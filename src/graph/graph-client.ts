import {
  Client, AuthenticationHandler, RetryHandler, RetryHandlerOptions, RedirectHandler,
  RedirectHandlerOptions, TelemetryHandler, HTTPMessageHandler,
} from '@microsoft/microsoft-graph-client';
import { GraphAuthManager } from './graph-auth.js';
import { getDefaultGraphApiVersion } from './constants.js';
import { recordThrottle, retryAfterSeconds } from './throttle-stats.js';

/** Base delay (seconds) when the service sends no Retry-After; the SDK backs off from it. */
const RETRY_DELAY_SECONDS = 3;
// The SDK's ceiling. Long seeding runs hit per-mailbox limits often, so waiting
// out throttling is better than failing the action after the default 3 tries.
const MAX_RETRIES = 10;

let cachedClient: Client | null = null;

/** Retry settings for Graph calls: record every throttling response, then let the SDK wait and retry. */
export function createRetryOptions(): RetryHandlerOptions {
  return new RetryHandlerOptions(RETRY_DELAY_SECONDS, MAX_RETRIES, (delay, attempt, _req, _opts, response) => {
    const wait = retryAfterSeconds(response.headers.get('Retry-After')) ?? delay * 2 ** attempt;
    recordThrottle(response.status, wait, 'graph');
    return true;
  });
}

/**
 * Returns a shared, app-only authenticated Graph client. Cached across calls
 * since token acquisition/refresh is handled by the underlying credential.
 * Uses the SDK's default middleware order, with a retry handler that records
 * each throttling response before it waits and retries.
 */
export function getGraphClient(): Client {
  if (!cachedClient) {
    const authManager = new GraphAuthManager();
    const auth = new AuthenticationHandler(authManager.getGraphAuthProvider());
    const retry = new RetryHandler(createRetryOptions());
    const redirect = new RedirectHandler(new RedirectHandlerOptions());
    const telemetry = new TelemetryHandler();
    auth.setNext(retry);
    retry.setNext(redirect);
    redirect.setNext(telemetry);
    telemetry.setNext(new HTTPMessageHandler());
    cachedClient = Client.initWithMiddleware({
      middleware: auth,
      defaultVersion: getDefaultGraphApiVersion(),
    });
  }
  return cachedClient;
}

/** Drop the cached client — call after Graph credentials change via the admin UI. */
export function resetGraphClient(): void {
  cachedClient = null;
}
