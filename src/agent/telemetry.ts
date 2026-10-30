// Agent 365 observability for agent mode (plan §5). One InvokeAgentScope per
// scheduled cycle, one ExecuteToolScope per workload, and an InferenceScope per
// OpenRouter call, exported over the S2S route with the agent identity's
// app-only token. Spans carry counts, settings and sanitized errors only:
// never mail bodies, generated text, UPNs or upstream error bodies.
// Interactive mode never calls startTelemetry, so every trace* helper below just
// runs its callback there.

import type { TokenCredential } from '@azure/identity';
import {
  BaggageBuilder, ExecuteToolScope, InferenceOperationType, InferenceScope, InvokeAgentScope,
  shutdownMicrosoftOpenTelemetry, useMicrosoftOpenTelemetry,
} from '@microsoft/opentelemetry';
import type {
  AgentDetails, CallerDetails, MicrosoftOpenTelemetryOptions, OpenTelemetryScope,
} from '@microsoft/opentelemetry';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { logger } from '../logger/logger.js';
import { getDataDir } from '../admin/config-store.js';
import { sanitizeUpstreamError } from '../admin/connectivity.js';
import { createAgentIdentityCredential } from '../graph/graph-auth.js';
import { graphConfig } from '../helpers/graph-config.helper.js';

/** The Agent 365 Observability API (commercial cloud). */
export const OBSERVABILITY_SCOPE = 'api://9b975845-388f-4429-889e-eab1ef63949c/.default';

interface TelemetryState {
  agent: AgentDetails;
  caller: CallerDetails;
}

let state: TelemetryState | null = null;

/** The activity source the admin center shows for every run. */
const CHANNEL = 'scheduler';

export interface TelemetryOptions {
  /** Token source for export; defaults to the configured agent identity. */
  credential?: TokenCredential;
  /** Send spans to Agent 365. Off in tests, which read spans from `spanProcessors`. */
  exporter?: boolean;
  spanProcessors?: MicrosoftOpenTelemetryOptions['spanProcessors'];
}

export function telemetryEnabled(): boolean {
  return state !== null;
}

/**
 * Start the OpenTelemetry pipeline with the Agent 365 exporter. Returns false,
 * and traces nothing, when the agent identity isn't configured.
 * APPLICATIONINSIGHTS_CONNECTION_STRING, when set, adds Azure Monitor export.
 */
export function startTelemetry(options: TelemetryOptions = {}, cfg = graphConfig): boolean {
  const tenantId = cfg.agentTenantId || cfg.graphTenantId;
  if (!cfg.agentId || !tenantId) {
    logger.warn('[TELEMETRY] Agent identity not configured; Agent 365 observability is off');
    return false;
  }
  const agentName = cfg.agentName || 'M365Mutator';
  const agent: AgentDetails = {
    agentId: cfg.agentId,
    agentName,
    agentDescription: 'Scheduled Microsoft 365 test-data mutations',
    agentBlueprintId: cfg.agentBlueprintId || undefined,
    tenantId,
  };
  // There's no signed-in caller: the blueprint sponsor stands in, which the
  // admin center needs before it shows the agent's activity.
  const caller: CallerDetails = {
    userDetails: {
      userId: process.env.AGENT365_SPONSOR_USER_ID || cfg.agentBlueprintId || cfg.agentId,
      userName: process.env.AGENT365_SPONSOR_USER_NAME || agentName,
      userEmail: process.env.AGENT365_SPONSOR_USER_EMAIL || undefined,
      tenantId,
    },
  };

  const credential = options.credential ?? createAgentIdentityCredential(cfg);
  const exporter = options.exporter ?? true;
  useMicrosoftOpenTelemetry({
    a365: {
      enabled: true,
      enableObservabilityExporter: exporter,
      useS2SEndpoint: true,
      // Spans that couldn't be sent wait here for replay, next to the other agent state
      // (the default, $TMPDIR, is wiped when App Service restarts).
      durableDelivery: { storageDirectory: join(getDataDir(), 'telemetry-spool') },
      // Only this agent's spans are exported; anything else gets no token and is skipped.
      tokenResolver: async (agentId, _tenantId, authScopes) => {
        if (agentId !== cfg.agentId) return '';
        try {
          return (await credential.getToken(authScopes?.[0] ?? OBSERVABILITY_SCOPE))?.token ?? '';
        } catch (err) {
          logger.warn(`[TELEMETRY] Observability token failed: ${sanitizeUpstreamError(err)}`);
          return '';
        }
      },
    },
    // Manual scopes only: no HTTP or logger spans carrying URLs or log text.
    instrumentationOptions: {
      http: { enabled: false },
      azureSdk: { enabled: false },
      console: { enabled: false },
      bunyan: { enabled: false },
      winston: { enabled: false },
    },
    enableConsoleExporters: false,
    // The default rate-limited sampler drops the first trace after a quiet
    // spell, which is every hourly cycle. Keep them all.
    tracesPerSecond: 0,
    samplingRatio: 1,
    spanProcessors: options.spanProcessors,
  });
  state = { agent, caller };
  logger.info(`[TELEMETRY] Agent 365 observability on for agent ${cfg.agentId}${exporter ? '' : ' (exporter off)'}`);
  return true;
}

/** Flush pending spans and stop the pipeline. */
export async function stopTelemetry(): Promise<void> {
  if (!state) return;
  state = null;
  try {
    await shutdownMicrosoftOpenTelemetry();
  } catch (err) {
    logger.warn('[TELEMETRY] Shutdown failed', err);
  }
}

/** Record a failure without its message reaching the span unsanitized. */
function recordFailure(scope: OpenTelemetryScope, err: unknown): void {
  scope.recordError(new Error(sanitizeUpstreamError(err)));
}

/**
 * Run one scheduled cycle as the root InvokeAgentScope, inside baggage that
 * names the tenant and agent (spans without it are dropped by the exporter).
 * `input` and the string `describe` returns are summaries, not content.
 */
export async function traceCycle<T>(input: string, fn: () => Promise<T>, describe: (result: T) => string): Promise<T> {
  if (!state) return fn();
  const { agent, caller } = state;
  // A scheduled agent has no chat conversation: each cycle is its own run, on the
  // 'scheduler' channel. The admin center groups activity by these.
  const runId = `cycle-${randomUUID()}`;
  const baggage = new BaggageBuilder()
    .tenantId(agent.tenantId)
    .agentId(agent.agentId)
    .agentName(agent.agentName)
    .agentBlueprintId(agent.agentBlueprintId)
    .operationSource('scheduler')
    .conversationId(runId)
    .sessionId(runId)
    .channelName(CHANNEL)
    .sessionDescription('scheduled-cycle')
    .build();
  return baggage.run(async () => {
    const request = { content: input, operationSource: 'scheduler', conversationId: runId, sessionId: runId, channel: { name: CHANNEL } };
    const scope = InvokeAgentScope.start(request, {}, agent, caller);
    try {
      return await scope.withActiveSpanAsync(async () => {
        scope.recordInputMessages([input]);
        const result = await fn();
        scope.recordOutputMessages([describe(result)]);
        return result;
      });
    } catch (err) {
      recordFailure(scope, err);
      throw err;
    } finally {
      scope.dispose();
    }
  });
}

/** Run one workload pass as an ExecuteToolScope (`mutate_<workload>`). */
export async function traceTool<T>(
  workload: string,
  args: Record<string, unknown>,
  fn: () => Promise<T>,
  describe: (result: T) => Record<string, unknown>,
): Promise<T> {
  if (!state) return fn();
  const scope = ExecuteToolScope.start(
    {},
    { toolName: `mutate_${workload}`, arguments: args, toolType: 'function', description: `Run the ${workload} workload` },
    state.agent,
    state.caller.userDetails,
  );
  try {
    return await scope.withActiveSpanAsync(async () => {
      const result = await fn();
      scope.recordResponse(describe(result));
      return result;
    });
  } catch (err) {
    recordFailure(scope, err);
    throw err;
  } finally {
    scope.dispose();
  }
}

export interface InferenceUsage {
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
}

/** Wrap one LLM call; `fn` reports token usage, never the prompt or completion. */
export async function traceInference<T>(
  model: string,
  fn: (record: (usage: InferenceUsage) => void) => Promise<T>,
): Promise<T> {
  if (!state) return fn(() => {});
  const scope = InferenceScope.start(
    {},
    { operationName: InferenceOperationType.CHAT, model, providerName: 'openrouter' },
    state.agent,
    state.caller.userDetails,
  );
  const record = (usage: InferenceUsage) => {
    if (usage.inputTokens !== undefined) scope.recordInputTokens(usage.inputTokens);
    if (usage.outputTokens !== undefined) scope.recordOutputTokens(usage.outputTokens);
    if (usage.finishReason) scope.recordFinishReasons([usage.finishReason]);
  };
  try {
    return await scope.withActiveSpanAsync(() => fn(record));
  } catch (err) {
    recordFailure(scope, err);
    throw err;
  } finally {
    scope.dispose();
  }
}
