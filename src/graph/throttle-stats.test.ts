import { describe, it, expect } from 'vitest';
import { RetryHandler, Context } from '@microsoft/microsoft-graph-client';
import {
  recordThrottle, throttleSnapshot, throttleDelta, recentThrottleCount, retryAfterSeconds,
} from './throttle-stats.js';
import { createRetryOptions, sdkBackoffSeconds, TerminalThrottleObserver } from './graph-client.js';

describe('retryAfterSeconds', () => {
  it('reads seconds and HTTP dates, and ignores junk', () => {
    expect(retryAfterSeconds('30')).toBe(30);
    expect(retryAfterSeconds(null)).toBeUndefined();
    expect(retryAfterSeconds('soon')).toBeUndefined();
    const now = Date.parse('2026-09-22T12:00:00Z');
    expect(retryAfterSeconds('Tue, 22 Sep 2026 12:01:00 GMT', now)).toBe(60);
  });
});

describe('throttle counters', () => {
  it('counts 429s and 503/504s separately and diffs snapshots', () => {
    const before = throttleSnapshot();
    recordThrottle(429, 10, 'graph');
    recordThrottle(503, 5, 'upload');
    const delta = throttleDelta(before, throttleSnapshot());
    expect(delta).toMatchObject({ events: 2, tooMany: 1, busy: 1, waitSeconds: 15, lastStatus: 503, lastSource: 'upload' });
    expect(recentThrottleCount()).toBeGreaterThanOrEqual(2);
  });
});

describe('sdkBackoffSeconds', () => {
  it('mirrors the SDK: the base delay first, then round((2^n - 1) / 2) + delay, capped at 180', () => {
    expect(sdkBackoffSeconds(3, 0)).toBe(3);   // first retry: delay only
    expect(sdkBackoffSeconds(3, 1)).toBe(5);   // second: round(1.5) + 3
    expect(sdkBackoffSeconds(3, 2)).toBe(7);   // third: round(3.5) + 3
    expect(sdkBackoffSeconds(3, 5)).toBe(35);  // sixth: 32 + 3
    expect(sdkBackoffSeconds(3, 9)).toBe(180); // tenth: 515, capped
  });
});

describe('Graph retry handler', () => {
  it('counts the throttled response that exhausts the retries', async () => {
    const before = throttleSnapshot();
    const observer = new TerminalThrottleObserver();
    const handler = new RetryHandler(createRetryOptions());
    observer.setNext(handler);
    let calls = 0;
    handler.setNext({
      execute: async (context: Context) => {
        calls++;
        context.response = new Response(null, { status: 429, headers: { 'Retry-After': '0' } });
      },
    });
    const context: Context = { request: 'https://graph.microsoft.com/v1.0/me', options: { method: 'GET' } };
    await observer.execute(context);
    expect(calls).toBe(11); // the first try plus ten retries
    expect(context.response?.status).toBe(429);
    // Ten recorded by the retry callback, one by the observer; none double-counted.
    expect(throttleDelta(before, throttleSnapshot())).toMatchObject({ events: 11, tooMany: 11 });
  });

  it('does not count a successful request', async () => {
    const before = throttleSnapshot();
    const observer = new TerminalThrottleObserver();
    observer.setNext({ execute: async (context: Context) => { context.response = new Response('{}', { status: 200 }); } });
    await observer.execute({ request: 'https://graph.microsoft.com/v1.0/me', options: { method: 'GET' } });
    expect(throttleDelta(before, throttleSnapshot()).events).toBe(0);
  });

  it('records a throttled response and retries it', async () => {
    const before = throttleSnapshot();
    const handler = new RetryHandler(createRetryOptions());
    let calls = 0;
    handler.setNext({
      execute: async (context: Context) => {
        calls++;
        context.response = calls === 1
          ? new Response(null, { status: 429, headers: { 'Retry-After': '0' } })
          : new Response('{}', { status: 200 });
      },
    });
    const context: Context = { request: 'https://graph.microsoft.com/v1.0/me', options: { method: 'GET' } };
    await handler.execute(context);
    expect(calls).toBe(2);
    expect(context.response?.status).toBe(200);
    expect(throttleDelta(before, throttleSnapshot())).toMatchObject({ events: 1, tooMany: 1 });
  });
});
