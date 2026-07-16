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
- **Agent Run** — one bounded execution attempt by exactly one Agent on exactly one Workroom Task, using exactly one Execution Environment. A task may have several runs because of failure, cancellation, retry, or reassignment. A run may contain a primary Session and harness-created child Sessions. Reconnecting the same Session continues the run; retrying with a new environment, harness, model, or task attempt creates a new run. Runs produce evidence, memory candidates, and Changeset Revisions. Human-owned tasks do not require a run.
- **Agent Client Protocol (ACP)** — the protocol Acepe speaks to coding agents. Provider-specific quirks are pushed to adapters at the edges.
- **Provider** — a concrete agent backend (e.g. Claude). Provider data is input, normalized by Rust adapters.
- **Adapter / history parser** — Rust-side component that normalizes raw provider data into the canonical model. The only place provider weirdness is allowed to live. Each major provider has **one module home** under `acp/providers/<name>/` (`provider.rs`, optional `enrichment.rs`, `settings.rs`, `model_catalog.rs`); `mod.rs` re-exports the public type and carries an **ingress edge map** (live parse, history restore, enrichment, snapshot rehydration) with pointers to parser, converter, and reconciler entry points. Classification tables stay in `acp/reconciler/providers/` (plan 009 home) and are referenced from the edge map, not duplicated. Thin adapters (`custom.rs`, `forge.rs`) may remain single-file by size judgment. No provider-named side-files beside the directory (e.g. no `cursor_session_update_enrichment.rs` at the `providers/` root). See plan `2026-06-11-015`.
- **Session** — one provider conversation or interaction stream belonging to exactly one Agent Run, with its own lifecycle and hot state. A harness may create child Sessions inside the same run. Session-shaped data paths are GOD-gated.
- **Session graph runtime registry** — Rust composition root for session hot state in `acp/session_state_engine/runtime_registry.rs` (`SessionGraphRuntimeRegistry`). Holds `SessionSupervisor`, delegates to ledger/tracker sub-modules, and retains envelope orchestration. Public interface unchanged for commands, bridge, and envelope router. GOD-gated.
- **Anchor ledger** — `AnchorLedger` in `session_state_engine/anchor_ledger.rs`. Owns per-session anchor timestamps for chunk timing (`record_chunk_timestamp`). Single mutex; no cross-map lock coupling.
- **Viewport ledger** — `ViewportLedger` in `session_state_engine/viewport_ledger.rs`. Owns the `TranscriptViewport` map plus materialize, height confirmation, and scroll-authority operations. Single mutex.
- **Buffer emission tracker** — `BufferEmissionTracker` in `session_state_engine/buffer_emission_tracker.rs`. Owns buffer emission records and push/advance/repair envelope builders. **Sole dual-lock holder** in the session state engine: acquires `buffer_emissions` then calls into `ViewportLedger` — never invert. See `docs/solutions/architectural/session-state-engine-ledger-decomposition-2026-06-11.md`.

### Canonical model
- **Canonical model** — the Rust-owned source of truth: canonical event order, identity, and tool-call mapping. The product's durable internal model, independent of any provider.
- **Provider projection** — Acepe's canonical representation of an object owned by an external collaboration, ticket, or version-control provider, including its Acepe identity, provider connection, object kind, external identity, revision or cursor, provenance, synchronization state, and Acepe-owned relationships. The tuple `(provider connection, object kind, external identity)` is unique and makes repeated provider events idempotent. The external provider remains authoritative for provider-owned fields: an Acepe command stays visibly pending until a provider event confirms it. Acepe-owned objects require no provider projection. _Avoid:_ copied object, local mirror.
- **Canonical transcript** — the ordered, canonical record of a session's events. Transcript **order** and **identity** are corrected here, never in the UI.
- **Display entry** — a UI-facing item projected from the canonical transcript.
- **Display id** — an Acepe-owned identifier for UI identity. Raw provider ids (e.g. Claude `message.id`) are **metadata**, not identity, unless the canonical model explicitly promotes them.
- **Tool call / tool operation** — a single agent tool invocation and its lifecycle, mapped canonically.
- **Tool identity authority** — `acp/reconciler/`: the single public interface for tool kind, canonical name, and argument interpretation. External callers route through `classify_raw_tool_call`, `classify_serialized_tool_call`, `semantic_transition`, `infer_kind_from_payload(_for_agent)`, `display_name_for_tool`, and `classify_kind_from_provider_name`; provider name tables, signal heuristics, and post-classification promotions are private behind this surface. Streaming and non-streaming inputs share one funnel (`classify_with_provider_name_kind`). Parser `ProviderParser::detect_tool_kind` is a provider-adapter name-table hook for parse-time hints, not a parallel classifier.
- **Transcript-derived operation linking** — Operations are linked to transcript entries by their `OperationSourceLink::TranscriptLinked { entry_id }`. The transcript is the authority: entry_ids are in acepe:: format (`"acepe::entry::{turn_key}::tool::{tool_call_id}"`), computed by `derive_tool_entry_id`. The canonical pipeline in `session_materialization` first builds the transcript, then relinks operations against it via `relink_operations_to_transcript` (key = `op.tool_call_id`, value = transcript `entry_id`). Any unmatched transcript tool row after relinking indicates missing provider evidence, not a format mismatch.

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
- **Organization** — the top Acepe ownership, security, and governance boundary. Its stable Acepe identity is independent from any Slack workspace, GitHub organization, or other provider tenant. It owns members, persistent agents, projects, collaboration spaces, provider connections, organization memory, and work policies. Data and authority never cross organizations without an explicit governed action. _Avoid:_ Slack workspace, GitHub organization, tenant when referring to the provider-neutral Acepe boundary.
- **External identity link** — a verified, organization-scoped, provenance-carrying connection between an Acepe member or agent and an account on a collaboration, ticket, version-control, or agent provider. The provider account is evidence about the identity, not the canonical identity itself. Matching email addresses never silently create or merge people, members, or authority.
- **Project** — a durable organization-owned software context that groups related repositories, workrooms, project memory, and project-level policy for one product or engineering effort. Every workroom belongs to exactly one project, though it may touch several repositories. _Avoid:_ local path, repository, Linear project.
- **Repository** — a provider-neutral version-controlled code resource attached to a project. Its remote provider and local checkouts are separate facts. _Avoid:_ project, project path.
- **Repository checkout** — a concrete filesystem copy of a repository inside an execution environment. A checkout may be the main clone or an isolated worktree. _Avoid:_ project, workspace.
- **Changeset** — one reviewable proposed code change belonging to exactly one workroom and one repository. It keeps a stable Acepe identity across revisions while branches, commits, pull requests, merge requests, and merge state remain native or provider-projected facts. A workroom may own several changesets across repositories. _Avoid:_ pull request, branch, diff when referring to the provider-neutral change.
- **Changeset revision** — an immutable version of a changeset's content used as the target of review, evidence, and approval. A later revision makes earlier revision-specific approval stale unless policy says the change is immaterial.
- **Evidence item** — an immutable, sourced proof record tied to an agent run, a workroom outcome, or an exact changeset revision, such as a test result, screenshot, log, or provider check. Evidence reports what happened; it does not itself approve the work.
- **Review** — a member or agent's assessment of a workroom outcome or exact changeset revision, based on available evidence. A review may accept, request changes, or record concerns, but it grants no authority by itself.
- **Approval** — an authority decision targeting an action, workroom outcome, or exact changeset revision. Authority comes from either a verified member with the required capability or an explicit work-policy rule whose recorded conditions are satisfied. Agents may review and recommend, but cannot approve their own action, increase their own authority, or be the sole authority for publishing, merging, production access, credential expansion, or organization-memory promotion. A later changeset revision makes revision-specific approval stale unless policy classifies the change as immaterial. Workrooms need only the approvals their policy requires.
- **Approval request** — the exact request created when an authorization decision returns `Require Approval`, bound to one proposed actor, capability, action, resource, parameter set, and workroom. It records risk, evidence, reason, eligible approvers, policy version, and expiry; approver authority is checked again on response. A material change to the action, resource, policy, or changeset revision makes it stale. Approval cannot authorize broader work, though an identical technical retry may reuse the same unexpired approval. Approval, denial, expiry, and staleness are audited.
- **Work authorization** — the policy decision that allows a work request to create one or more workrooms and establishes the approved outcome, resources, limits, and required approvals. It is not a permanent grant for every action taken inside those workrooms.
- **Authorization decision** — an immutable audit record produced when work is authorized or a sensitive action is attempted. It records the actor, requested capability, target resource and workroom, `Allow`, `Deny`, or `Require Approval`, the work-policy version and facts evaluated, the reason, time, and any expiry. Membership and policy changes affect future decisions but never rewrite past decisions or erase actions already performed.
- **Delegation grant** — the bounded authority given to exactly one agent for specified workroom tasks. Effective authority is the intersection of the agent's baseline capabilities, the work authorization, the delegator's authority, and the grant's explicit capabilities, resources, credentials, usage limits, expiry, and revocation state. The grant names the authorizing member or policy and whether further agent delegation is allowed. An agent cannot delegate authority it does not possess, and high-risk actions may still require fresh approval.
- **Credential lease** — short-lived access material delivered only after Acepe authorizes the related capability, scoped to one agent run, provider, resources, operations, and execution environment. It ends when the run, delegation grant, or source authority ends and is audited without recording secret values. An action may execute only when both Acepe authorization and the provider credential allow it; broad provider credentials never bypass Acepe policy, and Acepe authorization never expands provider permission.
- **Authority audit event** — an append-only record of a security-relevant identity, membership, role, capability, policy, authorization, approval, delegation, credential-access, provider-command, suspension, or removal event. It records the actor and source, target, related workroom or agent run, policy version, reason, result, time, and causal links. Events cannot be edited or deleted; corrections append new events. Secret and credential values are never recorded. Members with the required capability may inspect and export the history.
- **Person** — a human identity that can sign in to Acepe, independent from any organization or external provider account. A person may have one member record in each of several organizations but gains no organization authority merely by existing. _Avoid:_ user when sign-in identity matters.
- **Member** — the verified relationship between exactly one person and exactly one Acepe organization. The same person has separate membership, roles, and authority in each organization. Organization roles and work policies determine the member's authority. Only members may create work requests. _Avoid:_ user, person when organization membership matters.
- **Member lifecycle** — `Invited → Active → Suspended → Active | Removed`. Just-in-time enrollment may create an active member directly. Suspension immediately blocks new actions and work requests and pauses delegation grants for which the member is the sole authority until responsibility is reassigned. Removal is terminal for that membership but preserves identity links, decisions, approvals, and audit history; it does not delete the person or memberships in other organizations. Every organization must retain at least one active Owner-capable member, so Acepe rejects any suspension, removal, or role change that would remove the last one.
- **Membership policy** — organization-owned rules for invitations and just-in-time membership through verified provider identities. It defines eligible provider tenants, groups, channels, domains or identity classes, excluded guests, required approval, and initial roles. When policy allows, a first valid provider interaction may create a person and limited member automatically. When it does not, no work request is created and the sender receives an invitation or admin-approval path. Account linking always requires proof and never trusts matching email alone.
- **Role** — an organization-owned, human-friendly bundle of capabilities assigned to members, such as Owner, Admin, Developer, or Reviewer. Roles are editable templates for administration and display; authorization never checks a role name directly.
- **Capability** — a stable provider-neutral action that may be authorized for an actor on a resource, such as reading a repository, delegating an agent, creating an execution environment, publishing a changeset, granting an approval, promoting memory, or merging a change. Capability grants may be limited by resource, time, and conditions; work policy is the enforcement layer.
- **Collaboration space** — a long-lived organization-owned human-and-agent communication area that may be native to Acepe or projected from an external channel. It may link to zero, one, or several projects and may define one default project. _Avoid:_ workspace, room, channel when referring to the provider-neutral concept.
- **Work request** — a request for work from exactly one member, with immutable provenance linking to its source message, form, API call, or native action. It has not itself received authority to execute and must select exactly one project before policy evaluation. It may be rejected, withdrawn, accepted as one workroom, or explicitly split into several approved workrooms. _Avoid:_ prompt, job, ticket.
- **Work request lifecycle** — `Submitted → Pending Authorization → Accepted | Split | Rejected | Withdrawn → Settled`. `Accepted` creates exactly one authorized workroom; `Split` creates several explicitly approved workrooms; `Rejected` and `Withdrawn` create none. An accepted or split request becomes `Settled` only when every workroom it created reaches a terminal outcome. Clarification may pause the path without authorizing execution.
- **Work item** — the provider-neutral planning record for committed or considered work, including backlog identity, priority, status, and ownership. It may be native to Acepe or projected from Linear, Jira, or another ticket provider; it does not authorize or execute agent work. A workroom may have one primary work item and related work items, and a work item may be served by several workrooms over time. _Avoid:_ work request, workroom, task when referring to the tracked ticket.
- **Workroom** — the bounded record of one intended outcome originating from exactly one work request and belonging to exactly one project, from authorization through execution and review until the outcome is accepted, cancelled, declined, or abandoned. It has exactly one lead, one shared discussion, and one current acceptance contract; it may link work items, repositories, execution environments through agent runs, evidence, and zero or more changesets. Finishing an agent run or opening a pull request does not complete it; coding work normally completes when its required changesets merge. _Avoid:_ project, channel, permanent workspace.
- **Workroom lifecycle** — the compact canonical sequence `Authorized → Active → Awaiting Review → Accepted`, with `Cancelled`, `Declined`, and `Abandoned` as terminal alternatives. `Cancelled` means a policy-authorized actor intentionally stopped an outcome that is no longer wanted. `Declined` means an authorized acceptance actor rejected the proposed outcome and chose not to continue it. `Abandoned` is the exceptional recorded ending when the work cannot continue or reach a normal authority decision. An agent stopping cannot cause any of these endings by itself. The current status is derived from recorded facts and explicit actions, not freely overwritten. `Blocked` is a condition rather than a lifecycle state; `Changes requested` is a review result that returns work to `Active`; and `Approved` does not become `Accepted` until every required acceptance condition, normally including changeset merge, is satisfied. External ticket and version-control statuses remain provider projections and never control this lifecycle.
- **Acceptance contract** — the versioned conditions established when a workroom is authorized that define its intended outcome, completion criteria, required changesets and merge state, required evidence and approvals, and the member, agent, policy, or recorded facts allowed to accept it. It also supports non-code outcomes with no changeset. Agents may propose changes, but material scope changes require approval from an actor authorized by the work policy. Acepe derives `Accepted` when recorded facts satisfy the current contract; the status is not manually painted green.
- **Workroom lead** — the single member or agent accountable for a workroom's plan, delegation, and progress. The lead may delegate only within the work policy and does not gain privileged approval authority merely by leading.
- **Workroom task** — a visible unit of work belonging to exactly one workroom, with exactly one current owner who is a member or agent, plus explicit dependencies and completion conditions. _Avoid:_ hidden subagent task, agent todo.
- **Shared discussion** — the single canonical human-facing conversation of a workroom. It may be Acepe-native or synchronize both ways with one or more collaboration-provider threads allowed by policy. Every message retains its origin and projection state so retries and provider echoes cannot create duplicates or loops. Other threads may be linked as related context, but their messages enter the shared discussion only through an explicit share. Internal execution logs, reasoning, drafts, and private notes remain outside it.
- **Internal workroom note** — a message or artifact visible only inside Acepe, such as execution detail, draft review, or memory proposal. It is never published to a linked collaboration provider unless someone explicitly shares it. _Avoid:_ private Slack message.
- **Worktree** — an isolated git worktree used for parallel agent work / review.
- **Execution environment** — the isolated machine or sandbox, working copy, processes, credentials, and network policy assigned to one implementation agent at a time. It may run on a user's machine, Acepe infrastructure, customer infrastructure, or a third-party provider. _Avoid:_ coding environment, compute workspace.
- **Execution provider** — the integration boundary that creates or connects to execution environments and manages their lifecycle. _Avoid:_ VM provider, compute backend.
- **Compute usage** — the measured CPU, memory, storage, and running time consumed by an execution environment. Monetary cost is shown only when the execution provider supplies a reliable price.
- **Model usage** — the tokens, requests, or subscription capacity consumed through an agent's model provider. It is measured and governed separately from compute usage.
- **Composer** — the message-input surface (editor, toolbar, selectors). Follows the same View/controller split as the panel.
- **Review workspace** — the surface for reviewing an agent's changes: modified files, diffs, PR card.
- **Work policy** — versioned organization-owned rules that evaluate an actor's capabilities against a specific work request or attempted action, its resources, risk, usage limits, and required approvals. A work policy may authorize safe work automatically. Role names are never enforcement inputs; roles only supply capability grants. _Avoid:_ approval rules, Slack permissions.
- **Policy composition** — the deterministic, default-deny intersection of the actor's capability grants, the organization baseline, project policy, resource restrictions, work authorization, and any agent delegation grant. If no applicable rule allows a capability, it is denied; any applicable deny wins. A narrower scope may restrict but cannot silently expand higher-level authority. Every authorization decision records the policy versions used. Proposed policy versions are tested against example actions before activation, and provider or infrastructure limits remain hard constraints even when Acepe policy allows an action. There is no emergency, break-glass, or hidden administrator bypass.

### Memory concepts
- **Agent memory** — durable knowledge scoped to one agent's role, assignments, preferences, and lessons. It is not automatically visible to other agents.
- **Workroom memory** — the sourced decisions, evidence, and outcome retained for one workroom. It may be written automatically as part of the workroom's factual record.
- **Project memory** — governed knowledge shared across workrooms for one software project, such as architecture, conventions, and recurring lessons.
- **Organization memory** — governed knowledge shared across an organization, such as policy, glossary, identity, and security rules. _Avoid:_ global memory.
- **Memory proposal** — an agent-authored candidate for project or organization memory that becomes authoritative only through human approval or an explicit organization policy.

## Canonical Workroom graph invariants

Every canonical entity has an immutable Acepe-owned ID. Provider IDs are provenance and projection keys only; they never become canonical identity.

```text
Organization
├── Members
├── persistent Agents
├── Projects ── Repositories
├── Collaboration Spaces
├── Provider Connections
└── Work Policies

Work Request ── exactly 1 requester + source provenance
             └─ exactly 1 Project before authorization
             └─ 0..* Workrooms through rejection, acceptance, or approved split

Workroom ── exactly 1 Work Request + Project + Lead
         ├─ exactly 1 Shared Discussion + current Acceptance Contract
         ├─ 0..* Workroom Tasks, Work Item links, Changesets, Evidence Items
         └─ governed Workroom Memory and Internal Workroom Notes

Workroom Task ── exactly 1 Workroom + current owner (Member or Agent)
              └─ 0..* Agent Runs when the owner is an Agent

Agent Run ── exactly 1 Task + Agent + Execution Environment
          └─ 0..* Sessions; reconnecting a Session does not create a new Run

Changeset ── exactly 1 Workroom + Repository
          └─ 1..* immutable Changeset Revisions

Evidence Item / Review / Approval ── explicit target and provenance
Provider Projection ── exactly 1 provider connection + object kind + external ID
```

Execution environments are leased to at most one implementation run at a time, though an environment may be reused by later runs. Reviews and approvals that target a changeset revision become stale on a later revision unless the work policy classifies the difference as immaterial. A workroom becomes `Accepted` only when the recorded facts satisfy its current acceptance contract.

## Conventions that shape the language

- **TypeScript:** errors are values, not throws — `neverthrow` `Result`/`ResultAsync` everywhere (see ADR-0001). No `try/catch`, no `any`/`unknown`, no spread for provenance.
- **Svelte 5:** runes; no `$effect`; UI components are dumb/presentational in `@acepe/ui`.
- **Right-size by cohesion:** one responsibility per file, composed from a spine. See `CLAUDE.md` → Architecture.
