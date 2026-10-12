import {
  Client, AuthenticationHandler, RetryHandler, RetryHandlerOptions, RedirectHandler,
  RedirectHandlerOptions, TelemetryHandler, HTTPMessageHandler, Middleware, Context,
} from '@microsoft/microsoft-graph-client';
import { GraphAuthManager } from './graph-auth.js';
import { getDefaultGraphApiVersion } from './constants.js';
import { isThrottleStatus, recordThrottle, retryAfterSeconds } from './throttle-stats.js';

/** Base delay (seconds) when the service sends no Retry-After; the SDK backs off from it. */
const RETRY_DELAY_SECONDS = 3;
// The SDK's ceiling. Long seeding runs hit per-mailbox limits often, so waiting
// out throttling is better than failing the action after the default 3 tries.
const MAX_RETRIES = 10;
/** The SDK never sleeps longer than this between retries (RetryHandlerOptions.MAX_DELAY). */
const MAX_RETRY_DELAY_SECONDS = 180;

let cachedClient: Client | null = null;

/**
 * The wait the SDK applies when a throttled response carries no Retry-After,
 * for the zero-based `attempt` its shouldRetry callback receives. Mirrors
 * RetryHandler.getDelay (minus its sub-second jitter): the SDK increments the
 * count before computing round((2^n - 1) / 2) + delay, capped at 180 seconds.
 */
export function sdkBackoffSeconds(delay: number, attempt: number): number {
  const retries = attempt + 1;
  const backoff = retries >= 2 ? Math.round((2 ** retries - 1) / 2) + delay : delay;
  return Math.min(backoff, MAX_RETRY_DELAY_SECONDS);
}

/** Retry settings for Graph calls: record each throttling response the SDK is about to retry, then let it wait. */
export function createRetryOptions(): RetryHandlerOptions {
  return new RetryHandlerOptions(RETRY_DELAY_SECONDS, MAX_RETRIES, (delay, attempt, _req, _opts, response) => {
    const wait = retryAfterSeconds(response.headers.get('Retry-After')) ?? sdkBackoffSeconds(delay, attempt);
    recordThrottle(response.status, wait, 'graph');
    return true;
  });
}

/**
 * Sits in front of the retry handler and records a throttled response that
 * comes back as the final answer. The SDK consults shouldRetry only while it
 * has retries left, so the response that exhausts them never reaches the
 * callback above; any 429/503/504 seen here was therefore not yet counted.
 */
export class TerminalThrottleObserver implements Middleware {
  private next?: Middleware;

  async execute(context: Context): Promise<void> {
    if (!this.next) throw new Error('TerminalThrottleObserver has no next middleware');
    await this.next.execute(context);
    const status = context.response?.status;
    if (status !== undefined && isThrottleStatus(status)) recordThrottle(status, 0, 'graph', false);
  }

  setNext(next: Middleware): void {
    this.next = next;
  }
}

/**
 * Returns a shared, app-only authenticated Graph client. Cached across calls
 * since token acquisition/refresh is handled by the underlying credential.
 * Uses the SDK's default middleware order, with a retry handler that records
 * each throttling response before it waits and retries, and an observer in
 * front of it that counts the throttled response that ends a request.
 */
export function getGraphClient(): Client {
  if (!cachedClient) {
    const authManager = new GraphAuthManager();
    const auth = new AuthenticationHandler(authManager.getGraphAuthProvider());
    const observer = new TerminalThrottleObserver();
    const retry = new RetryHandler(createRetryOptions());
    const redirect = new RedirectHandler(new RedirectHandlerOptions());
    const telemetry = new TelemetryHandler();
    auth.setNext(observer);
    observer.setNext(retry);
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
