# Operations

An **operation** is the canonical record of runtime work inside a session.

Operations exist so Acepe can represent tool execution as durable product state instead of reconstructing it from transcript rows or provider-specific event timing.

## Why operations exist

Tool execution has more semantics than transcript history can safely carry.

A transcript row can tell you that a tool appeared in history. It cannot reliably own:

- lifecycle transitions,
- blocked reasons,
- permission linkage,
- stable typed arguments,
- timing,
- parent/child structure,
- reconnect and replay repair.

Operations solve that by giving runtime work its own canonical node.

Operations are also one of the canonical inputs to the session-level activity summary.

They do not directly own the final answer to "what is this session doing now?" on their own; instead, operation state is combined with lifecycle, interactions, and failure state to produce graph-backed session activity.

## What an operation owns

An operation should be the place shared code looks for:

- tool identity,
- canonical `operation_state`,
- provider status as provenance evidence only,
- blocked reason,
- typed display metadata,
- execution timing,
- parent/child links,
- explicit `source_link` transcript/source authority,
- raw evidence merged from provider signals.

## How operations are built

Operations are not authored directly by Svelte components.

They are produced by backend projection and then hydrated into desktop stores.

Typical path:

1. provider emits tool-related signals,
2. backend reducers and projections merge those signals into one operation record,
3. the frontend receives canonical snapshot/delta updates,
4. `OperationStore` materializes and updates operation state,
5. selectors drive tool-call UI.

## Important boundary

Transcript tool entries are still useful, but their role is narrower:

- transcript entry = "show this in history"
- operation = "this is the runtime truth of the work item"

That boundary matters because transcript replacement can legally degrade tool rows while operation state must stay stable enough to drive live UI.

Frontend transcript adapters must preserve that boundary. They may convert transcript tool rows into minimal ordering/spine entries, but they must not hydrate `OperationStore`, preserve rich legacy tool DTOs across transcript replacement, or route restored rows through desktop tool renderers. Rich rendering comes from graph materialization of canonical operations, and transcript-operation joins are valid only through an operation's explicit `source_link.kind === "transcript_linked"` plus matching `entry_id`.

## Lifecycle

Operations use an explicit canonical state machine:

- pending,
- running,
- blocked on interaction,
- completed,
- failed,
- cancelled/abandoned,
- degraded/partial.

The enum is independent of transcript-layer `ToolCall` DTOs. Provider `toolCallId` and `provider_status` may remain provenance evidence, but UI and product stores use canonical `operationId`, `operation_state`, and presentation DTOs derived from `operation_state`.

**lifecycle must be canonical and monotonic enough that reconnect/resume does not need to guess.**

Terminal states are completed, failed, cancelled/abandoned, and degraded/partial. `blocked` is not terminal: it is a resumable pause owned by linked interaction evidence. Later sparse or stale evidence may add diagnostics, but it must not regress a terminal operation back to active state.

## Blocking

Blocked state belongs to operations and their linked interactions, not to ad hoc UI conditions.

That means:

- a permission prompt can arrive before a full operation materializes,
- the system still preserves the blocked relationship,
- once the operation exists, the blocker attaches to the same canonical record,
- resolving the interaction moves the operation to the next canonical state, usually running or cancelled,
- terminal lifecycle updates clear blocker state instead of leaving the operation semantically stuck.

## What shared UI should do

Shared UI should ask selectors questions like:

- what is the current operation for this tool call?
- what title/command should be displayed?
- is the operation blocked by a permission?
- what was the last meaningful tool state?

Shared UI should **not** re-classify provider payloads, rebuild tool semantics from transcript text, or derive display lifecycle from `provider_status`.

Shared UI should also not collapse operation presence into its own session-level booleans like "planning" vs "working". That summary belongs to the graph-backed activity contract, which may preserve:

- whether any operation is active,
- how many operations are active,
- how many active subagents exist,
- which operation is dominant for rendering.

## Smells that usually mean operations are being bypassed

- current/last tool UI depends on transcript fallback rows
- permission rendering is matched by loose UI heuristics instead of canonical association
- reconnect needs special-case repair code in components
- the frontend tries to infer lifecycle from scattered raw events
- different surfaces disagree about which tool is current

## Final GOD endpoint

In the final architecture, operations are first-class graph nodes. Live provider events, provider-history restore, permissions, questions, todos, and plan approvals merge into canonical operation/interaction patches before desktop product code sees them. `ToolCallManager` is not operation truth; any remaining transport helper must be transport-only and must not mutate operation state, write operation stores, create operation identity, or provide alternate transcript-operation joins.

During short optimistic windows before a canonical scene exists, desktop may render transport coordination hints. Once a graph scene exists, those hints are not product authority; missing or sparse operation evidence must appear as explicit pending/degraded canonical scene state.
