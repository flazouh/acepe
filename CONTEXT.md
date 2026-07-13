# Acepe — Domain Context

The glossary and architectural narrative for Acepe. Skills (`improve-codebase-architecture`, `diagnose`, `tdd`, `ce-decompose`) read this to learn the project's vocabulary. When you name a concept — in a type, file, test, ADR, or proposal — use the term as defined here. If the concept you need is missing, that's a signal: either reconsider (you may be inventing language the project doesn't use) or add it (a real gap). Don't drift to synonyms.

> Status: **v0 bootstrap.** Grounded in `CLAUDE.md` and the current package layout. Extend and sharpen via `grill-with-docs` as decisions crystallise.

## What Acepe is

A Tauri 2 + SvelteKit 2 + Svelte 5 desktop app for driving AI coding agents via the **Agent Client Protocol**. The product goal is a production-grade Agentic Developer Environment: run, supervise, compare, and ship work from multiple agents without giving up engineering discipline.

## How truth flows (the core narrative)

```
Provider (Claude, etc.)  →  Rust adapters / history parsers  →  Canonical model (Rust-owned truth)
                                                                          │
                                                                          ▼
                                              Scene model (pure mapper, TS)  →  View (@acepe/ui)
```

Truth is **owned by canonical, Rust-side data**. Provider output is *input*, not product truth. Everything downstream (TypeScript, `@acepe/ui`) consumes canonical facts; it does not repair provider quirks. Bugs are fixed by **moving truth upstream**, never by patching the projection downstream. This principle is the GOD Architecture Gate (see `CLAUDE.md`).

## Glossary

### Protocol & session
- **Agent** — a persistent organization-owned AI teammate identity with a role, memory, permissions, and defaults. It remains the same agent when its provider, model, session, or execution environment changes. _Avoid:_ bot, model, provider when referring to the persistent teammate.
- **Agent Run** — one bounded execution attempt by exactly one Agent on exactly one Workroom Task, using exactly one Execution Environment. A task may have several runs because of failure, cancellation, retry, or reassignment. A run may contain a primary Session and harness-created child Sessions. Reconnecting the same Session continues the run; retrying with a new environment, harness, model, or task attempt creates a new run. Runs produce evidence, artifacts, memory candidates, and Changeset Revisions. Human-owned tasks do not require a run.
- **Agent Client Protocol (ACP)** — the protocol Acepe speaks to coding agents. Provider-specific quirks are pushed to adapters at the edges.
- **Provider** — a concrete agent backend (e.g. Claude). Provider data is input, normalized by Rust adapters.
- **Transport / ingress source** — Provider process and protocol transport stays under `acp/providers/<name>/`; provider-specific normalization lives under `acp/session/ingress/providers/<name>/`. Registered built-in providers expose typed history/live capabilities and one tool table; Custom and Forge report unsupported capabilities explicitly. Raw provider shapes may exist inside that ingress provider folder, but migrated shared downstream paths receive ordered `ProviderEvent` facts. See `docs/plans/2026-07-12-clean-session-ingress-architecture-plan.md`.
- **Session** — one provider conversation or interaction stream inside an Agent Run, with its own lifecycle and hot state. A harness may create child Sessions inside the same run. Session-shaped data paths are GOD-gated.
- **Session graph runtime registry** — Rust composition root for session hot state in `acp/session_state_engine/runtime_registry.rs` (`SessionGraphRuntimeRegistry`). Holds `SessionSupervisor`, delegates to ledger/tracker sub-modules, and retains envelope orchestration. Public interface unchanged for commands, bridge, and envelope router. GOD-gated.
- **Anchor ledger** — `AnchorLedger` in `session_state_engine/anchor_ledger.rs`. Owns per-session anchor timestamps for chunk timing (`record_chunk_timestamp`). Single mutex; no cross-map lock coupling.
- **Viewport ledger** — `ViewportLedger` in `session_state_engine/viewport_ledger.rs`. Owns the `TranscriptViewport` map plus materialize, height confirmation, and scroll-authority operations. Single mutex.
- **Buffer emission tracker** — `BufferEmissionTracker` in `session_state_engine/buffer_emission_tracker.rs`. Owns buffer emission records and push/advance/repair envelope builders. **Sole dual-lock holder** in the session state engine: acquires `buffer_emissions` then calls into `ViewportLedger` — never invert. See `docs/solutions/architectural/session-state-engine-ledger-decomposition-2026-06-11.md`.

### Canonical model
- **Canonical model** — the Rust-owned source of truth: canonical event order, identity, and tool-call mapping. The product's durable internal model, independent of any provider.
- **Provider projection** — Acepe's canonical representation of an object owned by an external collaboration, ticket, or version-control provider, including its provider identity, revision or cursor, provenance, synchronization state, and Acepe-owned relationships. The external provider remains authoritative for provider-owned fields; Acepe-owned objects require no provider projection. _Avoid:_ copied object, local mirror.
- **Canonical transcript** — the ordered, canonical record of a session's events. Transcript **order** and **identity** are corrected here, never in the UI.
- **Display entry** — a UI-facing item projected from the canonical transcript.
- **Display id** — an Acepe-owned identifier for UI identity. Raw provider ids (e.g. Claude `message.id`) are **metadata**, not identity, unless the canonical model explicitly promotes them.
- **Tool call / tool operation** — a single agent tool invocation and its lifecycle, mapped canonically.
- **Tool identity authority** — `acp/session/ingress/tool_identity/`: the single public interface for tool kind, canonical name, and argument interpretation. Provider tables and heuristics stay private behind `ToolTable`; live and history sources use the same classification funnel before the engine fold.
- **Transcript-derived operation linking** — On the canonical fold path, a tool row and its operation are created by the same `session::engine::fold` pass from one `ProviderEvent` and receive Acepe-owned ids at birth. Older compatibility open paths may still relink; the clean-ingress plan removes those remaining repairs.

### Agent panel (MVC)
- **Agent panel** — the primary surface that renders a session. Split View–Model–Controller across packages (see `CLAUDE.md` for the enforced table).
  - **View** — presentational components in `@acepe/ui` (`packages/ui/src/components/agent-panel/`). No Tauri, stores, or app logic.
  - **Scene model (`AgentPanelSceneModel`)** — the contract between Model and View; defined in `@acepe/ui` (`packages/ui/src/components/agent-panel/types.ts`).
  - **Model / scene mapper** — focused modules mapping desktop domain types → scene entry/strip/card models; composed by the materializer (`agent-panel-graph-materializer.ts`). `desktop-agent-panel-scene.ts` is a re-export barrel for those modules.
  - **Controller** — `agent-panel.svelte` (desktop): reads stores, builds the model, routes actions, supplies platform-specific snippet overrides.
  - **Scene** (`AgentPanelScene`) — convenience renderer in `@acepe/ui` mapping a `AgentPanelSceneModel` to the `AgentPanel` shell slots.
- **Materializer** — builds canonical agent-panel state from session state (`agent-panel-graph-materializer.ts` / `createAgentPanelGraphMaterializerReadModel`). Exposes the read model the Controller consumes; delegates conversation assembly to the **conversation-builder seam** (`conversation-dispatcher.ts` as the sole public entry for patch/rebuild paths). Entry-index fast paths (`graph-scene-entry-index.ts`) live behind the session-state seam, not in Controller logic. Canonical; GOD-gated.
- **Conversation-builder seam** — `conversation-dispatcher.ts`: pure orchestration that selects reuse → activity-only → patch fast paths → full rebuild and returns `{ conversation, scenePatch }`. Patch builders in `*-patch-conversations.ts` are dispatcher-internal; only the materializer read model and dispatcher may compose them.
- **Spine** — the thin, readable service/controller file that names and orders the focused units it composes. For agent-panel scene assembly, the spine is the graph materializer composing the conversation-builder seam; `desktop-agent-panel-scene.ts` is a re-export hub, not the spine. Every decomposition leaves one; fragments without a spine are shrapnel.
- **Sub-store** — a class owning a *disjoint slice* of a reactive store's `$state`/Maps plus the methods over it. The unit a god reactive store decomposes into (see ADR-0002). Distinct from a pure-helper module: a sub-store holds state, a helper does not.
- **Composition root / store facade** — the residual parent store after decomposition: holds sub-store instances and delegates its public interface to them in one-liners, preserving the external contract. Cross-slice reads flow through **accessor-closure dependencies**, never dual-ownership.

### Workspace concepts
- **Project** — a durable organization-owned software context that groups related repositories, workrooms, project memory, and project-level policy for one product or engineering effort. Every workroom belongs to exactly one project, though it may touch several repositories. _Avoid:_ local path, repository, Linear project.
- **Repository** — a provider-neutral version-controlled code resource attached to a project. Its remote provider and local checkouts are separate facts. _Avoid:_ project, project path.
- **Repository checkout** — a concrete filesystem copy of a repository inside an execution environment. A checkout may be the main clone or an isolated worktree. _Avoid:_ project, workspace.
- **Changeset** — one reviewable proposed code change belonging to exactly one workroom and one repository. It keeps a stable Acepe identity across revisions while branches, commits, pull requests, merge requests, and merge state remain native or provider-projected facts. A workroom may own several changesets across repositories. _Avoid:_ pull request, branch, diff when referring to the provider-neutral change.
- **Changeset revision** — an immutable version of a changeset's content used as the target of review, evidence, and approval. A later revision makes earlier revision-specific approval stale unless policy says the change is immaterial.
- **Evidence item** — an immutable, sourced proof record tied to an agent run, a workroom outcome, or an exact changeset revision, such as a test result, screenshot, log, or provider check. Evidence reports what happened; it does not itself approve the work.
- **Review** — a member or agent's assessment of a workroom outcome or exact changeset revision, based on available evidence. A review may accept, request changes, or record concerns, but it grants no authority by itself.
- **Approval** — an authority decision by a member or agent allowed by the work policy, targeting a workroom outcome or exact changeset revision. A later changeset revision makes revision-specific approval stale unless policy classifies the change as immaterial. Workrooms need only the approvals their policy requires.
- **External requester** — a person identified through a connected collaboration provider who may submit work requests without first registering an Acepe account. An external requester has no privileged Acepe authority unless a work policy explicitly grants it. _Avoid:_ guest member, anonymous user.
- **Member** — a verified human identity within an Acepe organization, linked as needed to identities from collaboration, ticketing, and version-control providers. Organization roles and work policies determine the member's authority. _Avoid:_ user when organization membership matters.
- **Collaboration space** — a long-lived organization-owned human-and-agent communication area that may be native to Acepe or projected from an external channel. It may link to zero, one, or several projects and may define one default project. _Avoid:_ workspace, room, channel when referring to the provider-neutral concept.
- **Work request** — a sourced request for work that has not yet received authority to execute. It must select exactly one project before policy evaluation; it may be rejected, withdrawn, accepted as one workroom, or explicitly split into several approved workrooms. The request reaches an ending state only when every accepted workroom does. _Avoid:_ prompt, job, ticket.
- **Work item** — the provider-neutral planning record for committed or considered work, including backlog identity, priority, status, and ownership. It may be native to Acepe or projected from Linear, Jira, or another ticket provider; it does not authorize or execute agent work. A workroom may have one primary work item and related work items, and a work item may be served by several workrooms over time. _Avoid:_ work request, workroom, task when referring to the tracked ticket.
- **Workroom** — the bounded record of one intended outcome originating from exactly one work request, from authorization through execution and review until the outcome is accepted, cancelled, declined, or abandoned. Finishing an agent run or opening a pull request does not complete it; coding work normally completes when its change is merged. A workroom may link an external discussion, ticket, repository, execution environments, agent sessions, evidence, and a delivered changeset. _Avoid:_ project, channel, permanent workspace.
- **Workroom lead** — the single member or agent accountable for a workroom's plan, delegation, and progress. The lead may delegate only within the work policy and does not gain privileged approval authority merely by leading.
- **Workroom task** — a visible unit of work within a workroom with exactly one current owner, explicit dependencies, and completion conditions. _Avoid:_ hidden subagent task, agent todo.
- **Shared discussion** — the human-facing messages of a workroom that synchronize both ways with its linked collaboration-provider thread. Every message retains its source identity and synchronization state.
- **Internal workroom note** — a message or artifact visible only inside Acepe, such as execution detail, draft review, or memory proposal. It is never published to a linked collaboration provider unless someone explicitly shares it. _Avoid:_ private Slack message.
- **Worktree** — an isolated git worktree used for parallel agent work / review.
- **Execution environment** — the isolated machine or sandbox, working copy, processes, credentials, and network policy assigned to one implementation agent at a time. It may run on a user's machine, Acepe infrastructure, customer infrastructure, or a third-party provider. _Avoid:_ coding environment, compute workspace.
- **Execution provider** — the integration boundary that creates or connects to execution environments and manages their lifecycle. _Avoid:_ VM provider, compute backend.
- **Compute usage** — the measured CPU, memory, storage, and running time consumed by an execution environment. Monetary cost is shown only when the execution provider supplies a reliable price.
- **Model usage** — the tokens, requests, or subscription capacity consumed through an agent's model provider. It is measured and governed separately from compute usage.
- **Composer** — the message-input surface (editor, toolbar, selectors). Follows the same View/controller split as the panel.
- **Review workspace** — the surface for reviewing an agent's changes: modified files, diffs, PR card.
- **Permission** — a gate where the agent requests approval for an action before proceeding.
- **Work policy** — organization-owned rules that evaluate a work request's requester, resources, permissions, usage limits, and required approvals. A work policy may authorize safe requests automatically. _Avoid:_ approval rules, Slack permissions.

### Memory concepts
- **Agent memory** — durable knowledge scoped to one agent's role, assignments, preferences, and lessons. It is not automatically visible to other agents.
- **Workroom memory** — the sourced decisions, evidence, and outcome retained for one workroom. It may be written automatically as part of the workroom's factual record.
- **Project memory** — governed knowledge shared across workrooms for one software project, such as architecture, conventions, and recurring lessons.
- **Organization memory** — governed knowledge shared across an organization, such as policy, glossary, identity, and security rules. _Avoid:_ global memory.
- **Memory proposal** — an agent-authored candidate for project or organization memory that becomes authoritative only through human approval or an explicit organization policy.

## Conventions that shape the language

- **TypeScript:** errors are values, not throws — `neverthrow` `Result`/`ResultAsync` everywhere (see ADR-0001). No `try/catch`, no `any`/`unknown`, no spread for provenance.
- **Svelte 5:** runes; no `$effect`; UI components are dumb/presentational in `@acepe/ui`.
- **Right-size by cohesion:** one responsibility per file, composed from a spine. See `CLAUDE.md` → Architecture.
