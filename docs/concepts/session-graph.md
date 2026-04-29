# Session graph

The **session graph** is Acepe's canonical model of product state for a session.

It is the durable structure that the rest of the architecture should look to when deciding what is true.

## What the session graph owns

The session graph owns the state that must remain correct across:

- live streaming updates,
- reconnect,
- reopen,
- refresh,
- replay/import,
- provider-specific transport quirks.

In practice, that means the session graph owns:

- transcript history,
- operations,
- interactions,
- runtime lifecycle,
- session activity summary,
- lifecycle actionability/recovery metadata,
- capabilities and config envelopes,
- telemetry and budget state.

## What the session graph does not own

The session graph does **not** mean every raw event disappears.

Raw transport updates still exist for:

- optimistic UI,
- coordination while a session is being registered,
- observability and debugging,
- provider adapter mechanics.

But raw events are not allowed to become a second durable database.

## Authority rule

Acepe should have **one durable authority path** for session truth:

`provider facts/history/live events -> provider adapter edge -> SessionSupervisor / canonical reducer -> canonical session graph -> revisioned materializations -> desktop stores/selectors -> UI`

If a feature needs to answer "what is the current tool?", "can this session send?", "should the primary CTA be resume or retry?", or "what runtime state should survive reopen?", it should answer from the session graph or a store materialized from it.

## Final GOD endpoint

The final GOD architecture is not a convergence target with long-lived compatibility bridges. It is the settled authority model:

- provider-specific quirks stop at the adapter edge,
- the backend-owned graph owns product truth,
- graph/transcript frontiers are internal continuity markers, not peer authorities,
- desktop stores/selectors project canonical materializations,
- raw provider traffic and raw ACP updates may remain only as redacted diagnostics or coordination, never as product truth.

Old authorities such as `ToolCallManager` operation truth, frontend hot-state lifecycle truth, raw session-update semantic truth, and local journal/snapshot restore truth are deletion targets unless they are structurally demoted behind an observability boundary.

## Main graph nodes

## 1. Transcript entries

Transcript entries represent the conversation history shown to the user.

They are important for rendering history, but they are not rich enough to own all runtime semantics.

## 2. Operations

Operations represent durable runtime work such as tool execution and its lifecycle.

They own facts like:

- canonical `operation_state`,
- provider status as provenance evidence only,
- blocked reason,
- typed semantic fields,
- timing,
- parent/child links,
- explicit source links for transcript-operation joins,
- evidence merged from live and replayed signals.

## 3. Interactions

Interactions represent things the system is waiting on from a human or policy path, such as:

- permission requests,
- questions,
- plan/apply approvals.

They are canonical state, not transient UI popups.

## 4. Activity

Activity is the session-level summary that answers:

- what is this session doing now,
- is it awaiting model output,
- is it running one or more operations or sub-agents,
- is it blocked on a human interaction,
- is it paused or in error.

For this pipeline, activity is graph-backed state, not a frontend guess.

It is derived from canonical lifecycle, operations, interactions, and failure state, then carried through the revisioned graph/envelope path so reopen and live sessions can render the same answer.

Typical fields include:

- dominant activity kind (`awaiting_model`, `running_operation`, `waiting_for_user`, `paused`, `error`, `idle`),
- active operation count,
- active subagent count,
- dominant operation linkage,
- blocking interaction linkage.

## Invariants

The architecture should preserve these invariants:

1. **One state, many views.** Transcript, current tool UI, queue badges, session previews, and session activity copy may render different slices, but they must derive from the same underlying graph.
2. **Raw updates are observational unless promoted.** A transport event can coordinate UX, but it does not own durable truth by itself.
3. **Revisions matter.** Canonical envelopes apply in revision order and can be buffered until the target session is registered.
4. **Transcript is not operation authority.** Tool rows in transcript history are presentation data, not the sole live source of runtime tool state. A rich tool row may join to an operation only through `OperationSourceLink::TranscriptLinked`.
5. **Provider quirks belong at the edge.** Provider-specific parsing and lifecycle policy must be resolved before shared UI/store code consumes the state.
6. **Lifecycle truth is backend-owned.** Shared UI may render lifecycle, but it may not reconstruct it from `isConnected`, raw transport timing, or hot-state.
7. **Actionability is canonical too.** Status alone is not enough; resume/retry/send/archive affordances must come from canonical actionability/recovery fields.
8. **Session activity is graph-backed.** Shared UI may render compact variants like "thinking" or "streaming," but it may not decide session-level activity from raw tool timing, transcript order, or local booleans once graph activity exists.
9. **Transcript adapters are spine-only.** A transcript snapshot adapter may create lightweight row DTOs so virtualized history can preserve ordering, but it may not hydrate operation stores, preserve rich tool DTOs, or choose product tool renderers.
10. **Graph scene materialization is the rendering boundary.** Historical/restored tool rows render from `AgentPanelSceneModel`; if a tool row has no matching transcript-linked operation, the scene should expose an explicit pending/degraded row rather than falling back to desktop tool semantics.
11. **Operation presentation derives from canonical operation state.** `provider_status` remains raw provider provenance. UI display status comes from canonical `operation_state` mapped into presentation DTOs, not from transcript-layer status or local provider-name/title heuristics.

## Design consequence

When adding a new feature, ask:

1. Is this durable product state?
2. If yes, where does it live in the canonical session graph?
3. Which store materializes it?
4. Which selector renders it?

If the answer starts with "the component can infer it from a transcript row" or "the frontend can reconstruct it from raw events," that is usually a sign the architecture is drifting.

For the concrete lifecycle machine and flow diagrams, see [Session lifecycle](./session-lifecycle.md).
