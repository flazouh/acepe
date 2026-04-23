# Session lifecycle

The **session lifecycle** is Acepe's canonical model for whether a session is live, resumable, blocked on attach, or terminal.

It exists so shared code does not have to guess from transport status, frontend hot-state, or provider-specific timing.

Lifecycle is not the whole session-activity answer.

For this pipeline, lifecycle and session activity are related but separate canonical graph-backed fields:

- **lifecycle** answers whether the session is detached, ready, failed, reconnecting, and what actions are allowed,
- **activity** answers whether the session is awaiting model output, running work, blocked on an interaction, paused, in error, or idle.

Shared UI may render both, but it must not reconstruct session activity from lifecycle alone once the graph activity contract exists.

## Authority chain

Acepe's lifecycle truth flows through one path:

```mermaid
flowchart LR
  A[Provider transport facts / preview facts] --> B[SessionSupervisor]
  B --> C[Canonical lifecycle state]
  B --> D[Canonical actionability / recovery fields]
  B --> E[Canonical capability envelopes]
  B --> F[Revision-bearing lifecycle journal]
  C --> G[Canonical session graph + snapshot]
  D --> G
  E --> G
  F --> G
  G --> H[Desktop stores and selectors]
  H --> I[UI]
```

Provider adapters may report facts like disconnected, connected, preview capabilities, retryability, or provenance.
They do **not** publish canonical `Ready`, `Detached`, or `Failed` directly.

## The seven-state machine

| State | Meaning | Typical allowed actions |
|---|---|---|
| `Reserved` | Session exists but has never attached transport yet | preview, open, first-send activation, archive |
| `Activating` | Supervisor is attaching transport for first live use | wait |
| `Ready` | Live and dispatchable | send, set model/mode, archive |
| `Reconnecting` | Automatic recovery is in progress after live disconnect | wait, stop waiting if canonically offered |
| `Detached` | Not live, but resumable | resume, archive |
| `Failed` | Deterministic error or explicit error handling required before attach is legal | retry only when canonically allowed, archive |
| `Archived` | Closed and read-only | none |

Two rules matter most:

1. `Detached` is the canonical **resumable non-live** state.
2. `Reserved` is the only pre-live state that allows **first-send activation**.

## Public commands vs internal repair

The stable public lifecycle surface is:

- `reserve`
- `preview_capabilities`
- `open`
- `resume`
- `send`

Internal implementation may still use activation/reconnect helpers, but the user-facing recovery verb is `resume`, not `reconnect`.

## Main flows

### 1. New session -> first-send activation

```mermaid
flowchart LR
  A[Desktop] -->|reserve| B[Reserved]
  B -->|open history/frontier only| C[openToken armed]
  B -->|optional preview_capabilities| D[Preview facts]
  C -->|send first prompt| E[SessionSupervisor]
  D --> E
  E -->|begin_activation with ActivationOptions + initial prompt| F[Activating checkpoint]
  F -->|adapter connect(...)| G[Connected + capabilities facts]
  G -->|complete_activation| H[Ready checkpoint + capabilities envelope]
  H --> I[Buffered updates released]
```

Important detail: the waiter resolves on **`Ready` plus canonical capabilities**, not lifecycle alone.

### 2. Cold reopen -> explicit resume

```mermaid
flowchart LR
  A[Persisted checkpoint] --> B[SessionSupervisor.restore_from_checkpoint]
  B --> C[Detached restored_requires_attach]
  B --> D[Detached abandoned_in_flight]
  B --> E[Archived]
  B --> F[Failed]
  C --> G[open returns history-first state]
  D --> G
  E --> G
  F --> G
  G -->|resume from Detached| H[Begin activation / attach path]
  H --> I[Ready]
```

Cold-open never pretends a previously live session is still live. A reopened session must become live again through explicit resume.

### 3. Live disconnect -> internal reconnect -> detached fallback

```mermaid
flowchart LR
  A[Ready] -->|transport disconnected| B[Reconnecting]
  B -->|reconnect succeeds| A
  B -->|retry budget exhausted or user stops waiting| C[Detached reconnect_exhausted]
  C -->|resume| D[Activating / attach path]
  D --> A
```

`Reconnecting` is an internal repair phase. If it cannot recover inside policy bounds, the session becomes `Detached`, not a fake-live state and not a generic failure.

## Canonical actionability

Lifecycle status alone is not enough for UI.

Canonical lifecycle payloads also carry fields like:

- `statusReason`
- `availableActions`
- `recommendedAction`
- `recoveryPhase` / `retryability`
- `lifecycleRevision`

That is what lets the UI show the right CTA without reconstructing policy from local booleans.

The same rule applies to session activity copy: "Planning next moves", working/tool activity, waiting-for-user prompts, and paused/error affordances must flow from graph-backed activity materialized by desktop stores, not from ad hoc lifecycle/status heuristics.

## Capability rule

Capabilities follow the same authority discipline as lifecycle:

```mermaid
flowchart LR
  A[Preview capabilities] -->|advisory only while Reserved| B[Staged pre-activation choices]
  C[Activation capabilities] -->|authoritative for first live state| D[Canonical live capabilities]
  E[Later capability deltas] -->|canonical revisions applied in order| D
  B --> C
```

If preview-selected options are invalid at activation time, the supervisor rejects the activation before prompt dispatch and leaves the session correctable.

## Relationship to the current plan stack

- The proving slice establishes this lifecycle model end to end on the root provider path.
- The follow-on convergence work removes the remaining compatibility bridge, hot-state, and non-canonical desktop derivations.

Conceptually: **prove the authority model first, then converge the rest of the app onto it.**
