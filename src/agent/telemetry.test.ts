import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { TokenCredential } from '@azure/identity';
import { startTelemetry, stopTelemetry, telemetryEnabled, traceCycle, traceInference, traceTool } from './telemetry.js';
import type { graphConfig } from '../helpers/graph-config.helper.js';

type GraphConfig = typeof graphConfig;

// No usage metrics to Microsoft from test runs.
process.env.MICROSOFT_OTEL_SDKSTATS_DISABLED = 'true';

const AGENT = 'c7303cc2-444e-4484-8802-30c641292cd3';
const TENANT = 'e81f6370-697c-40a8-ba8b-5978bcbd676f';
const PROMPT = 'Generate a one-paragraph text summary of a little-known scientific fact';
const COMPLETION = 'Octopuses have three hearts.';

const exporter = new InMemorySpanExporter();
const credential: TokenCredential = { getToken: vi.fn(async () => ({ token: 't', expiresOnTimestamp: Date.now() + 3_600_000 })) };

function byName(fragment: string): ReadableSpan {
  const span = exporter.getFinishedSpans().find(s => s.name.includes(fragment));
  expect(span, `span containing "${fragment}"`).toBeDefined();
  return span!;
}

/** Everything a span would send: name, attributes, events and status. */
function payload(span: ReadableSpan): string {
  return JSON.stringify({ name: span.name, attributes: span.attributes, events: span.events, status: span.status });
}

/** One cycle with a tool call and an inference inside it, the way the scheduler and random-text nest them. */
async function runCycle(toolFn: () => Promise<{ ok: number; failed: number }>) {
  return traceCycle('Scheduled cycle: mail x2 (app)', () => traceTool(
    'mail', { runs: 2, allowDeletions: false, credential: 'app' },
    async () => {
      await traceInference('openai/gpt-4o-mini', async record => {
        record({ inputTokens: 21, outputTokens: 34, finishReason: 'stop' });
        return COMPLETION;
      });
      return toolFn();
    },
    r => r,
  ), () => 'ok: mail 2 ok/0 failed');
}

describe('telemetry before start', () => {
  it('runs callbacks untraced', async () => {
    expect(telemetryEnabled()).toBe(false);
    expect(await traceCycle('x', async () => 42, () => 'y')).toBe(42);
    expect(await traceInference('m', async record => { record({ inputTokens: 1 }); return 'z'; })).toBe('z');
  });

  it('stays off without an agent identity', () => {
    expect(startTelemetry({ exporter: false }, { agentId: '', agentTenantId: '', graphTenantId: '' } as GraphConfig)).toBe(false);
    expect(telemetryEnabled()).toBe(false);
  });
});

describe('telemetry', () => {
  beforeAll(() => {
    const cfg = { agentId: AGENT, agentTenantId: TENANT, agentName: 'M365Mutator-test', agentBlueprintId: 'fb2dc41c-0037-4c03-8f18-a39dd73738c7' } as GraphConfig;
    expect(startTelemetry({ credential, exporter: false, spanProcessors: [new SimpleSpanProcessor(exporter)] }, cfg)).toBe(true);
  });
  afterAll(() => stopTelemetry());
  beforeEach(() => exporter.reset());

  it('nests tool and inference spans under one invoke_agent root', async () => {
    await runCycle(async () => ({ ok: 2, failed: 0 }));
    const cycle = byName('invoke_agent');
    const tool = byName('mutate_mail');
    const inference = byName('openai/gpt-4o-mini');
    expect(cycle.parentSpanContext?.spanId).toBeUndefined();
    expect(tool.parentSpanContext?.spanId).toBe(cycle.spanContext().spanId);
    expect(inference.parentSpanContext?.spanId).toBe(tool.spanContext().spanId);
    expect(inference.attributes['gen_ai.usage.input_tokens']).toBe(21);
  });

  it('puts the tenant and agent identity on every span', async () => {
    await runCycle(async () => ({ ok: 2, failed: 0 }));
    expect(exporter.getFinishedSpans()).toHaveLength(3);
    for (const span of exporter.getFinishedSpans()) {
      expect(span.attributes['microsoft.tenant.id'], span.name).toBe(TENANT);
      expect(span.attributes['gen_ai.agent.id'], span.name).toBe(AGENT);
      expect(span.attributes['microsoft.channel.name'], span.name).toBe('scheduler');
      expect(span.attributes['gen_ai.conversation.id'], span.name).toMatch(/^cycle-/);
    }
    const runs = new Set(exporter.getFinishedSpans().map(s => s.attributes['gen_ai.conversation.id']));
    expect(runs.size).toBe(1);
  });

  it('never records prompts, completions or raw upstream errors', async () => {
    await expect(runCycle(async () => { throw new Error('401 Bearer abc.def.ghi for user@contoso.com'); })).rejects.toThrow();
    const all = exporter.getFinishedSpans().map(payload).join('\n');
    expect(all).not.toContain(COMPLETION);
    expect(all).not.toContain(PROMPT);
    expect(all).not.toContain('abc.def.ghi');
    expect(byName('mutate_mail').status.message).toContain('[REDACTED]');
  });
});
