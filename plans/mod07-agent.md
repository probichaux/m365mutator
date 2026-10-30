# mod07-agent

Run M365Mutator as a registered **Microsoft Agent 365** agent in an Entra ID tenant,
on a configurable schedule, with every parameter the admin UI exposes today.
Tracks GitHub issue [#7](https://github.com/probichaux/m365mutator/issues/7).

Research date: 2026-10-29. Agent 365 has been GA for Commercial since 2026-05-01;
the docs change often, so re-check the links below before each phase.

## Background: what "an Agent 365 agent" means for this tool

The tool is a background job with no chat, so it fits Agent 365's **autonomous
(S2S) agent** pattern. Per [Agent 365 identity](https://learn.microsoft.com/microsoft-agent-365/developer/identity)
and [Choose an integration option](https://learn.microsoft.com/microsoft-agent-365/developer/choose-integration-option),
we keep our own runtime and add the platform capabilities in code:

| Capability | What it gives us | How |
| --- | --- | --- |
| **Identity** | A first-class Entra **agent identity**, created from an **agent identity blueprint**. It gets a sponsor, Conditional Access, sign-in/audit logs tagged as an agent, and lifecycle governance. | `a365 setup all`; tokens come from the [autonomous app OAuth flow](https://learn.microsoft.com/entra/agent-id/agent-autonomous-app-oauth-flow) (blueprint credential plus `fmi_path`, then the agent identity uses client credentials with a `client_assertion`). |
| **Observability** | Runs, tool calls, and inference show up under **Agents → Activity** in the M365 admin center and flow on to Defender and Purview. | [Microsoft OpenTelemetry Distro](https://learn.microsoft.com/microsoft-agent-365/developer/microsoft-opentelemetry) (`@microsoft/opentelemetry`) with the Agent 365 exporter on the **S2S route**. The deprecated `@microsoft/agents-a365-observability` package is not used. |
| **Registry / governance** | The agent appears in the M365 admin center inventory, admins create instances from the blueprint, and the agent can be disabled centrally. | `a365 publish` builds a manifest; it is uploaded under **Agents → All agents → Upload custom agent**. |
| **Notifications** | The agent can receive and answer Teams, Outlook, and Word messages. | `@microsoft/agents-a365-notifications` plus an **agent user account**. This is **Frontier preview only**, so it ships as an optional phase. |
| **Tooling (Work IQ MCP)** | Governed MCP servers for Mail, Calendar, SharePoint, and similar workloads. | Not used (see Non-goals). |

## Using the Agent 365 Skills

The [Connect an existing agent quickstart](https://learn.microsoft.com/microsoft-agent-365/developer/get-started)
is skills-driven, and the skills (`microsoft/agent365-skills`) are installed in
Claude Code. They replace hand-run CLI steps and some hand-written code:

| Quickstart step | Skill | Use here |
| --- | --- | --- |
| Set up and detect | `a365-setup` | **Phase 1.** Validates the CLI and Azure prerequisites, detects the Node.js stack, and routes to the standard-agent path. Answer **standard agent** (not AI teammate) and auth mode **S2S**. |
| Register | `make-a365-agent` | **Phase 1.** Runs `a365 setup all` to create the blueprint, the agent identity, and the S2S **application** permissions. Writes `a365.generated.config.json`. Afterward, check that the Graph app roles in §6 are present. |
| Messaging and notifications | `make-ai-teammate` | **Not used.** That's the AI teammate (Frontier) path. Phase 8, if it happens, re-evaluates this. |
| Observability | `instrument-observability` | **Phase 6.** For `s2s` it scaffolds a token-service file (the FMI chain) plus the distro, exporter, and scopes. Run it, then fold its token service into `AgentIdentityCredential` (§3) so Graph and Observability share one FMI implementation instead of two. Review its scope placement against §5. |
| Work IQ tools | `add-workiq-tools` | **Skipped.** The quickstart notes Work IQ needs delegated auth and is skipped automatically for S2S, which matches the non-goal below. |
| DLP | `purview-dlp-integration` | **Not used.** There are no user prompts to gate; the OpenRouter prompts are fixed strings in code. |
| Test locally | `test-local` | **Not applicable.** AI teammates only (Agents Playground needs `/api/messages`). |
| Validate | `a365-code-validator` | **End of Phase 6 and before every release.** Read-only preflight of exporter activation, agent-ID binding (not the blueprint ID), app-only token shape, S2S endpoint, required spans, and blueprint grants. |

Points from the quickstart that this plan depends on:

- Setup uses the Microsoft-managed **Agent 365 CLI** enterprise app, so no
  custom client app registration is needed.
- **Identity needs no extra license. Observability needs an E7 or Agent 365
  license *assigned* to at least one user**; the SKU merely existing in the
  tenant isn't enough. Without that, telemetry is **dropped silently** even
  though export returns HTTP 200. Phase 1 checks the assignment, not just that
  the license exists.
- A run with no valid `invoke_agent` **root** span is queryable in Defender
  advanced hunting but doesn't appear in the admin center, Defender, or Purview.
  §5 makes the per-cycle `InvokeAgentScope` the root of every run, and nothing
  (including token refresh or the startup Graph check) may emit spans outside it.
- Skills are state-aware and skip completed work. Rerunning them is safe.

## Hosting options considered

Microsoft-ecosystem hosts are acceptable. Here is how the three realistic options compare:

| Option | Fit | Why |
| --- | --- | --- |
| **Self-hosted plus the Agent 365 SDK** (Azure App Service created by `a365 setup all`) | **Recommended** | Our mutation engine is deterministic TypeScript with no LLM reasoning loop. It runs unchanged inside an always-on process that can own a timer. We control the blueprint, its permissions, and its credential (managed identity FIC, so no secrets). Observability, registry, and notifications are all available. |
| **[Foundry hosted agent](https://learn.microsoft.com/azure/foundry/agents/concepts/hosted-agents)** (our code as a container) | Viable alternative, deferred | Foundry assigns the agent identity automatically and [registry-syncs it to Agent 365](https://learn.microsoft.com/azure/foundry/agents/concepts/agent-365-integration). Against it: sessions are provisioned per request, so an in-process timer can't drive the schedule and an external trigger (Logic App or Functions timer calling the Invocations endpoint) is needed. Activity export for hosted agents still needs the Agent 365 SDK and observability permissions, and the identity changes on publish, so grants must be redone. It also adds a Foundry project, ACR, and container build for no functional gain. |
| **[Copilot Studio](https://learn.microsoft.com/microsoft-agent-365/builder/identity)** | Poor fit | Agents share a tenant-wide Copilot Studio blueprint, and we can't bring our own identity or permissions. M365 access goes through Power Platform connectors, mostly OBO, which can't do app-only bulk writes across many mailboxes and sites. Reproducing the docx/pdf generation and weighted operations would mean calling our code through a custom connector, and our backend would then make the Graph writes under its own credential, outside the agent identity. |

The blocked-permission constraint below applies to **every** option, because it
is enforced on agent identities by Entra, not by the host. Hosting choice
doesn't change Decision 1. If the Foundry route becomes attractive later (for
example, to drop App Service), the engine refactor in Phase 2 and the
credential in Phase 3 carry over. Only the scheduler trigger changes.

## The blocking constraint: permissions agents can't hold

Entra **refuses to grant** some high-risk Graph permissions to agent identities,
whatever an admin consents to
([blocked list](https://learn.microsoft.com/graph/api/resources/agentid-platform-overview?view=graph-rest-1.0#microsoft-graph-permissions-blocked-for-agents)).
Here is how that maps onto our workloads:

| Workload | Today (app registration) | Allowed for an agent? | Agent-mode plan |
| --- | --- | --- | --- |
| Identities | `User.ReadWrite.All` | **Blocked** | No agent-grantable permission covers `jobTitle`, `department`, `streetAddress`, and the other attributes. Identities is **unavailable in agent mode** (see Decision 1). |
| Mail | `Mail.ReadWrite`, `Mail.Send` | Allowed | Same permissions. Recommend scoping with [Exchange RBAC for Applications](https://learn.microsoft.com/exchange/permissions-exo/application-rbac) to a test-mailbox management scope. |
| Calendar | `Calendars.ReadWrite`, `MailboxSettings.Read` | Allowed (only `Calendars.Read` is blocked) | Same permissions. Same RBAC scoping recommendation. |
| OneDrive | `Files.ReadWrite.All` | **Blocked** | Switch to **`Sites.Selected`** (not blocked). An admin grants the agent identity `write` on each target OneDrive site collection. |
| SharePoint | `Sites.ReadWrite.All` | **Blocked** | **`Sites.Selected`** with a per-site `write` grant. |
| Deletions | Reuses Mail / Calendar / Files | Mail and Calendar allowed; OneDrive needs `Sites.Selected` | Same as the workloads above. |
| Target loading | `User.Read.All` (implied), `/sites?search=*` | `User.Read.All` allowed | User enumeration works. Site enumeration under `Sites.Selected` probably returns only granted sites (**verify in Phase 1**). |

Consequences:

- In agent mode, OneDrive and SharePoint can only touch sites that have been
  granted to the agent. "Random %" for those categories samples **from the
  granted set**, not from the whole tenant.
- We ship a helper, `helpers/Grant-MutatorAgentSiteAccess.ps1`, that an admin
  runs (it needs `Sites.FullControl.All` *delegated*, as the admin) to grant or
  revoke `write` for the agent identity on a list of site URLs or OneDrive owners
  via `POST /sites/{id}/permissions`.
- The README gets an agent-mode permission table next to the existing one.

## Decisions

Decisions 1 and 2 and the `.env.example` question were confirmed 2026-10-29.
Decisions 3–5 are proposed defaults.

1. **Identities in agent mode (confirmed):** **excluded.** The scheduler rejects
   a schedule that enables Identities while the auth mode is `agent`, and the
   Schedule page explains why. There is no hybrid fallback to the classic app
   registration.
2. **One codebase, a run mode; no admin UI in agent mode (confirmed):**
   `M365MUTATOR_MODE=interactive|agent` (default `interactive`). Both modes
   share the mutation engine. Agent mode starts the scheduler and the
   OpenTelemetry pipeline, and serves **only** `GET /health` and a read-only
   `GET /api/agent/status`. It never serves the admin UI or any mutating
   `/api/*` route. Schedules are authored in interactive mode and deployed to the
   agent as a file or app setting (Decision 5).
3. **Hosting:** document **Azure App Service** (the resources `a365 setup all`
   creates) with the blueprint federated to the Web App's **managed identity**,
   so no secret is stored. Certificate and client-secret blueprint credentials
   stay supported for local or container runs; secrets are for development only,
   per Entra guidance.
4. **Schedule format:** a fixed **interval in minutes** with optional **jitter**
   and an optional **active window** (days of week plus local start and end time
   in an IANA time zone). No cron expressions in v1, so no new dependency.
5. **Config source of truth:** a versioned **`schedule.json`** in the data dir,
   next to `config.json` and `targets.json`. The Schedule page in interactive
   mode authors it and exports a **bundle** (`schedule.json` plus the
   `targets.json` it refers to) for the hosted agent. The agent reads them from
   the data dir (App Service mounted storage) or from the
   `M365MUTATOR_SCHEDULE_JSON` and `M365MUTATOR_TARGETS_JSON` app settings.
6. **Hybrid credentials (confirmed 2026-10-30, after the Phase 1 spike):**
   Exchange and SharePoint reject app-only tokens from the agent identity (see
   [Phase 1 findings](#phase-1-findings-2026-10-29--30)). Agent mode therefore
   uses the **agent identity** for registration, governance, directory reads,
   and observability, and the **classic app registration** (certificate or
   client secret, as today) for the workload writes. The credential is chosen
   **per workload** by config, so moving a workload to the agent identity once
   Microsoft supports it is a setting change, not a code change. The spans for
   each cycle still carry the agent identity ID. The status endpoint and
   `docs/agent-setup.md` must say plainly which identity performs the writes.
   A support case is open with Microsoft.

## Design

### 1. Shared mutation engine (refactor first)

Today the validation, target resolution, and dispatch for each workload live
inline in `admin-routes.ts` handlers. Move them into
`src/admin/workload-runner.ts`:

```ts
type WorkloadRequest =
  | { workload: 'identities' }
  | { workload: 'mail'; runs: number; allowDeletions: boolean }
  | { workload: 'calendar' | 'onedrive' | 'sharepoint'; runs: number }
  | { workload: 'deletions'; workloads: DeletionWorkload[]; scope: DeletionScope; after?: string; before?: string };

runWorkload(req: WorkloadRequest): Promise<WorkloadResult>  // throws WorkloadInputError → 400
```

The routes become thin wrappers with unchanged HTTP behaviour; existing route
tests must still pass. The scheduler calls the same function.

### 2. Agent configuration (`src/agent/schedule-store.ts`)

`schedule.json`, sanitized like `targets-store.ts` (hand-edits are coerced, never trusted):

```jsonc
{
  "version": 1,
  "enabled": true,
  "intervalMinutes": 60,          // 5–10080
  "jitterMinutes": 5,             // 0–intervalMinutes/2
  "runOnStart": false,
  "activeWindow": {               // optional; absent = always
    "timeZone": "America/Chicago",
    "days": ["mon","tue","wed","thu","fri"],
    "start": "08:00", "end": "18:00"
  },
  "workloads": {
    "mail":       { "enabled": true,  "runs": 3, "allowDeletions": false },
    "calendar":   { "enabled": true,  "runs": 2 },
    "onedrive":   { "enabled": true,  "runs": 2 },
    "sharepoint": { "enabled": false, "runs": 1 },
    "identities": { "enabled": false },
    "deletions":  { "enabled": false, "workloads": ["mail"], "scope": "before",
                    "before": "-30d" }   // relative dates allowed for recurring runs
  }
}
```

- **Targets** (explicit list, random style, random %) still come from
  `targets.json`, so the agent and the UI share one target definition.
- **Relative dates** (`-30d`, `-2w`) for Deletions resolve at each run, since a
  fixed date makes little sense for a recurring job. Absolute `YYYY-MM-DD` still
  works.
- A recurring Deletions schedule needs the explicit acknowledgement field
  `"acknowledgeDestructive": true`, mirroring the UI checkbox.
- Graph, OpenRouter, and agent-identity settings stay in `config.json` and env
  vars (see §3).

### 3. Agent identity auth (`src/graph/agent-identity-credential.ts`)

The agent identity is a **second credential** next to the app registration,
not a third `GraphAuthMode`: under Decision 6 both are configured at once.
`AgentIdentityCredential implements TokenCredential` and does the two-hop flow
from [Authenticate and acquire tokens for autonomous agents](https://learn.microsoft.com/entra/agent-id/autonomous-agent-authentication-authorization-flow):

1. **T1:** the blueprint credential gets a token for `api://AzureADTokenExchange/.default`
   with `fmi_path=<agent identity client id>`. The credential is a managed
   identity assertion, a certificate assertion, or a client secret.
2. **Resource token:** `client_id=<agent identity>`, `grant_type=client_credentials`,
   `client_assertion=T1`, `scope=<resource>/.default`.

Notes:

- `@azure/msal-node` doesn't support `fmi_path` yet (per the Agent 365 Node
  sample), so hop 1 is a raw `fetch` to the v2 token endpoint. Certificate
  assertions are signed with Node `crypto`; managed identity uses
  `ManagedIdentityCredential` from the existing `@azure/identity`.
- Cache by `(resource, agentId)` and refresh 5 minutes before expiry. The same
  credential serves Graph (`https://graph.microsoft.com/.default`) and
  Observability (`api://9b975845-388f-4429-889e-eab1ef63949c/.default`).
- `createAgentIdentityCredential()` in `graph-auth.ts` builds it from the
  runtime config, and it plugs into the existing `TokenCredentialAuthProvider`.
- New config fields and env vars, named to match the Agent 365 samples:
  `AGENT365_TENANT_ID`, `AGENT365_BLUEPRINT_ID`, `AGENT365_AGENT_ID`,
  `AGENT365_CLIENT_SECRET` (dev only), `AGENT365_CERTIFICATE_PATH`,
  `AGENT365_USE_MANAGED_IDENTITY`, `AGENT365_MANAGED_IDENTITY_CLIENT_ID`,
  `AGENT365_AGENT_NAME`. Secrets get the same `[REDACTED]` logging and 0600 file
  handling as today.
- If the agent is **disabled or deleted** in the admin center, token
  acquisition fails. The scheduler treats that as a hard stop for the cycle,
  logs it, and backs off exponentially (capped at the interval). It doesn't
  run the cycle with the classic credential instead: a blocked agent stops all
  writes, even the ones Decision 6 routes through the app registration. So
  each cycle starts with an agent token preflight, even when every workload
  uses `"app"`.
- **Per-workload credential (Decision 6):** `schedule.json` gets
  `credentials: { mail, calendar, onedrive, sharepoint, deletions }`, each
  `"agent" | "app"`, defaulting to `"app"` while the
  Exchange and SharePoint limitation stands. `graph-client.ts` caches one
  Graph client per credential (`'app' | 'agent'`) and binds the current one
  with `AsyncLocalStorage` (`withGraphCredential`), so the `src/graph/*`
  helpers keep calling `getGraphClient()` unchanged. `runWorkload(req, opts)`
  takes `credential` and `directoryCredential`, both defaulting to `'app'`
  (interactive mode). In agent mode, target resolution uses the agent
  identity. Directory reads made *inside* a workload (user attributes) run
  under that workload's credential, which is the app registration today.
  Phase 4 maps `schedule.json` onto these options.

### 4. Scheduler (`src/agent/scheduler.ts`)

- Computes the next fire time from `intervalMinutes`, then jitter, then the
  active-window clamp, using `setTimeout`. Pure next-run math lives in
  `computeNextRun(now, schedule)` so it can be unit-tested.
- **Overlap protection:** if a cycle is still running when the next one is due,
  that run is skipped and logged.
- **Per cycle:** runs the enabled workloads **sequentially** (each already
  parallelizes internally at concurrency 5). One workload failing doesn't abort
  the rest.
- **Run history:** the last 50 cycle summaries (start, end, per-workload
  ok/fail counts, sampled errors) go to `agent-runs.json` in the data dir.
- **Hot reload:** a changed `schedule.json` or `targets.json` file (for example,
  a redeployed bundle) re-arms the timer without a restart. App-setting changes
  restart the App Service anyway.
- **Graceful shutdown:** on SIGTERM, stop arming new cycles, wait up to 60
  seconds for the current one, then flush telemetry.
- `GET /api/agent/status` (read-only JSON) shows mode, enabled state, next run,
  the last cycle summary, and token health. It holds no secrets and no
  per-item results, only counts and sanitized error codes.

### 5. Observability (`src/agent/telemetry.ts`)

- `useMicrosoftOpenTelemetry({ a365: { enabled: true, useS2SEndpoint: true,
  tokenResolver } })`. The resolver returns the cached app-only Observability
  token from §3. Started through `node --import @microsoft/opentelemetry/loader`
  in agent mode, because the project is ESM. Add a `start:agent` script.
- A `BaggageBuilder` sets the tenant ID, agent ID (the **agent identity** app
  ID, not the blueprint's), and agent name around each cycle. Spans without
  these are dropped by the exporter.
- **Span mapping.** All three span types are required for
  [store validation](https://learn.microsoft.com/microsoft-agent-365/developer/microsoft-opentelemetry#store-validation-attributes):
  - `InvokeAgentScope`: one per scheduled cycle. The input message is the
    schedule summary; the output message is the cycle summary.
  - `ExecuteToolScope`: one per workload pass (`mutate_mail`, `mutate_calendar`,
    and so on), with the arguments (runs, target count, run style) and the
    response (ok/fail counts).
  - `InferenceScope`: wraps each OpenRouter call in `random-text.ts`, recording
    the model ID and token usage when OpenRouter returns them. When no key is
    set, the run uses the GUID fallback and no inference span is emitted.
- Optionally also export to Azure Monitor when
  `APPLICATIONINSIGHTS_CONNECTION_STRING` is set. Interactive mode keeps the
  current logging only, with no OpenTelemetry.
- Never put mail bodies, generated document text, or upstream error bodies in
  spans. Record counts and sanitized error codes only (reuse
  `sanitizeUpstreamError`).

### 6. Registration, packaging, publishing

- Add `agent/` containing a template `a365.config.json` (no secrets), a
  `manifest/manifest.json` with name, description, and version kept in sync with
  `package.json`, and color and outline icons based on `favicon.svg`.
- Add `a365.generated.config.json` and `agent/manifest/manifest.zip` to
  `.gitignore`. The generated config **contains the blueprint client secret**.
- Document the operator flow in `docs/agent-setup.md`:
  1. Prerequisites: an Agent 365 license on at least one user; the Global
     Administrator or Agent ID Developer role; an Azure subscription;
     `az login`; the a365 CLI.
  2. `a365 setup all --agent-name m365mutator`.
  3. Remove the CLI's default delegated grants and `allAllowed` inheritance,
     then assign the **application** roles `Mail.ReadWrite`, `Mail.Send`,
     `Calendars.ReadWrite`, `MailboxSettings.Read`, `User.Read.All`, and
     `Sites.Selected` to the agent identity's service principal through Graph.
     `a365 setup permissions custom` only handles delegated scopes (Phase 1
     finding). Ship this as a helper script.
  4. Global Administrator consent. When run as Agent ID Developer, the CLI
     prints the consent URL for the admin.
  5. Run `Grant-MutatorAgentSiteAccess.ps1` for the OneDrive and SharePoint targets.
  6. Optionally scope mailboxes with Exchange RBAC for Applications.
  7. `a365 deploy` (or deploy to another host), then `a365 publish` and upload
     `manifest.zip`.
  8. Create the instance in the M365 admin center and assign the **sponsor**.
     Recommend tagging the agent identity with a custom security attribute
     (`Environment=Test`) plus a Conditional Access policy that confines it,
     because it writes to tenant data.
  9. Verify activity under **Agents → (agent) → Activity**.
- Update `helpers/Create-MutatorAppReg.ps1` only with a pointer to the agent
  doc. Classic app-registration mode stays as is.

### 7. Admin UI: Schedule page

- A new **Schedule** nav item and page (`SchedulePage.tsx`) built from
  **Fluent UI** controls: interval and jitter `SpinButton`s, an active-window
  picker, one card per workload reusing `RunStepper` and the existing Mail and
  Deletions controls, and an enable `Switch`.
- **Validate**, **Save**, and **Export bundle** buttons, plus a "Run this
  schedule once now" button that runs one cycle locally for testing.
- The page exists only in interactive mode, because agent mode has no UI
  (Decision 2).
- Optional: an "Agent status" field takes the hosted agent's URL and shows its
  `/api/agent/status` (next run, last cycle). The browser fetches it, so the
  CSP `connectSrc` would need that origin added. Defer if it complicates CSP.
- The Settings flyout gets a third auth option, **Agent identity**, with the
  blueprint ID, agent ID, and credential type fields, plus a "Test agent token"
  button that runs both hops and reports which one failed.
- Workloads blocked in agent mode are shown disabled with an explanatory
  tooltip.
- **Localize every new string** in en, de, fr, nl, and uk: new `schedule.json`
  locale namespace files plus additions to `settings` and `nav`.

### 8. Notifications (optional, Frontier-gated)

Behind `AGENT365_ENABLE_NOTIFICATIONS=true`, and only for tenants in the
[Frontier program](https://adoption.microsoft.com/copilot/frontier-program/)
because this needs an agent user account:

- Use the Microsoft 365 Agents SDK (`@microsoft/agents-hosting`) and
  `@microsoft/agents-a365-notifications` to host `POST /api/messages`, with JWT
  auth from the SDK.
- Teams chat commands for the sponsor or manager: `status`, `run now`,
  `pause`, `resume`, and `last run`. Free text is not supported, and no LLM is
  used for command parsing.
- Optionally post a cycle summary to the sponsor's chat (`Chat.Create`, which
  is allowed). `Chat.ReadWrite.All` and `Chat.Read.All` are blocked for agents
  and aren't needed.
- Register with `a365 setup all --m365` so the messaging endpoint is
  registered. This phase is **deferred until the tenant is enrolled**, and the
  rest of the plan doesn't depend on it.

## Non-goals and rationale

- **Work IQ MCP tooling.** Those servers expose governed, mostly delegated,
  per-user tools for an LLM to call. The mutator does deterministic app-only
  bulk writes across many mailboxes and sites. Routing that through MCP adds an
  LLM loop and a dependency, and doesn't cover our operations (attachments,
  docx/pdf uploads, folder moves). Revisit only if a conversational "mutate
  Alice's mailbox" feature is wanted.
- **AI teammate path** (`--aiteammate`). The agent has no persona or chat
  surface beyond the optional Phase 8.
- **Multi-tenant blueprint or publisher verification.** This is a single-tenant
  test tool for now.

## Phases (one PR each)

1. **Spike (no merge):** run `a365-setup`, then `make-a365-agent` (standard
   agent, S2S) against the test tenant. Confirm an E7 or Agent 365 license is
   *assigned* to a user. Prove the two-hop token works from Node, `Sites.Selected` writes work for a granted
   OneDrive and SharePoint site, site enumeration behaves as expected under
   `Sites.Selected`, Mail and Calendar app permissions are consentable on the
   agent identity, and S2S observability export appears in the admin center.
   Record the findings in this plan.
2. **Engine refactor:** `workload-runner.ts`, thin routes, tests unchanged and green.
3. **Agent identity auth:** credential, config, Settings UI option, and token test.
4. **Scheduler and schedule store:** `schedule.json`, `M365MUTATOR_MODE=agent`,
   run history, status endpoint, agent-mode workload gating.
5. **Schedule UI:** page, localization, export.
6. **Observability:** run `instrument-observability` (S2S), merge its token
   service into `AgentIdentityCredential`, and add baggage, the three scopes,
   and an OpenRouter inference span. Finish with a clean `a365-code-validator`
   run.
7. **Packaging and docs:** `agent/` folder, manifest and icons, site-grant
   script, `docs/agent-setup.md`, README agent-mode section and permission table,
   `.gitignore`.
8. **Notifications (optional):** Teams commands, when Frontier is available.

### Phase 1 findings (2026-10-29 – 30)

Test tenant `blackdotpub.com`, a365 CLI 2.0.1, Node 26, run by a Global
Administrator.

- **Setup.** `a365 setup all --agent-name M365Mutator-test --authmode s2s`
  created the blueprint (`fb2dc41c-…`), the agent identity
  "M365Mutator-test Identity" (`c7303cc2-…`), and the registration
  (`206eb8e6-…`). The admin center shows the agent as **Available** right
  away, so there's no separate activation step. `a365 publish` does nothing for
  blueprint agents ("Nothing to publish").
- **CLI defaults are broader than we want.** `setup all` grants tenant-wide
  delegated consent (Graph `Mail.ReadWrite`, `Mail.Send`, `Chat.ReadWrite`,
  `User.Read.All`, `Sites.Read.All`, `Files.ReadWrite.All`,
  `ChannelMessage.*`, plus Power Platform and Agent 365 Tools scopes). It also
  sets `allAllowed` inheritable permissions on three resources. It assigns
  **no** S2S app roles unless they're configured beforehand, and
  `a365 setup permissions custom` only manages delegated grants and
  inheritance. We removed all of it by hand and assigned app roles through
  Graph. **A `setup all` rerun restores the defaults**, so
  `docs/agent-setup.md` needs a post-setup cleanup step, or we pre-seed
  `a365.config.json` so the CLI doesn't add them.
- **The CLI writes `.env`.** For a Node project it writes `.env` (not
  `appsettings.json`) with the blueprint secret and observability settings.
  Document this. The app reads its own `AGENT365_*` names, so the operator maps
  them.
- **The two-hop token from Node works.** Raw `fetch` with `fmi_path`. The token
  has `appid`/`oid` = agent identity, `idtyp=app`,
  `xms_par_app_azp` = blueprint, and the expected `roles`. The Observability
  token (`api://9b975845-…`) also works with no roles, as documented.
- **Graph directory reads work** (`GET /users/{upn}` with `User.Read.All`).
- **Exchange and SharePoint reject the agent identity.** Mailbox settings,
  messages, sendMail, events, `/sites?search=*`, and `/users/{upn}/drive` all
  return **401**: an empty body from Exchange, and
  `unauthenticated: "Request is allowed in this context."` or `generalException`
  from SharePoint. The roles are present in the token, and the result is the
  same whether they're assigned directly to the agent identity or inherited from
  the blueprint (`inheritableRoles: allAllowed`). It persisted for more than 10
  hours, and the target mailbox and OneDrive are licensed. Hence Decision 6, and
  a Microsoft support case.
- **Not yet verified, because of the 401:** `Sites.Selected` per-site grants,
  OneDrive writes, `/sites` enumeration under `Sites.Selected`, and S2S
  observability appearing in the admin center. Recheck all of these when the
  support case resolves.

Version: 0.7.0 when Phase 4 lands (the first user-visible agent mode), with
patch bumps per later phase and CHANGELOG entries for each.

## New dependencies

- `@microsoft/opentelemetry`: the observability distro (Phase 6).
- `@microsoft/agents-hosting` and `@microsoft/agents-a365-notifications`:
  Phase 8 only.
- No scheduler, cron, or MSAL dependency. Token hop 1 is raw `fetch` and the
  timer is `setTimeout`. `@azure/identity` (already present) provides
  `ManagedIdentityCredential`.

## Tests

- `computeNextRun`: interval, jitter bounds (seeded RNG), active-window clamping
  across midnight, DST transitions, and an all-days-disabled window rejected by
  validation.
- `schedule-store` sanitization: clamping, unknown keys dropped, Deletions
  without `acknowledgeDestructive` rejected, relative-date parsing, Identities
  rejected in agent mode.
- Scheduler: overlap skip, sequential workloads with one failure, back-off on
  token failure, hot reload, shutdown drain (vitest fake timers).
- `AgentIdentityCredential`: both hops with mocked `fetch` (request bodies
  include `fmi_path` and `client_assertion`), caching and early refresh, and
  error surfacing per hop.
- `workload-runner`: parity tests proving routes and scheduler produce the same
  results for the same inputs (mock Graph).
- Telemetry: spans carry tenant and agent baggage, and contain no body text
  (in-memory span exporter).

## Risks / open points

- **Blocked permissions are the main product limitation.** Identities is
  excluded (Decision 1), and file workloads need per-site grants. Microsoft says
  the blocked list "will evolve", so recheck at each phase. If
  `User.ReadWrite.All` or a granular replacement becomes grantable, revisit
  Identities.
- **`Sites.Selected` and OneDrive:** granting per user's personal site is
  supported but tedious at scale. The grant script should accept a CSV of UPNs
  and resolve each user's personal site URL. Verify in Phase 1 that writes to
  `/users/{id}/drive/...` work under a site-level grant, or switch those calls
  to `/sites/{id}/drive/...`.
- **`fmi_path` and MSAL:** the raw token call is a small, isolated piece of
  hand-rolled OAuth. Swap to MSAL once it supports `fmiPath`.
- **Licensing:** Agent 365 needs a qualifying license (E7, or an add-on to
  E5/A5/Business Premium) on at least one user. The test tenant has one
  (confirmed 2026-10-29). `docs/agent-setup.md` still states the requirement for
  other operators.
- **`.env.example`:** updating it is approved. Each phase adds its new variables
  there as they land: `AGENT365_*` in Phase 3, `M365MUTATOR_MODE` and the
  schedule settings in Phase 4, and `APPLICATIONINSIGHTS_CONNECTION_STRING` in
  Phase 6. `.env` itself is never touched.
- **No remote schedule editing:** the agent has no UI (Decision 2), so a schedule
  change means redeploying the bundle. If live remote editing is wanted later,
  it needs real auth (Entra sign-in on the App Service). That's out of scope.
