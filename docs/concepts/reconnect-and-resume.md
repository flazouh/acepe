# Reconnect and resume

Reconnect and resume are where architectural drift gets exposed fastest.

If Acepe has split authority, reconnect/resume will usually show it through:

- missing runtime state,
- lost blocked state,
- duplicated messages,
- incorrect current tool badges,
- prompts that vanish or attach to the wrong thing.

## Principle

Reconnect and resume should restore from **provider-owned persisted history first**, then layer live runtime/cache data on top where appropriate.

They must not depend on Acepe persisting a second local restore authority or on the live process registry being the only place runtime truth exists.

In the settled lifecycle model, the public recovery action is `resume`. `reconnect` is an internal supervisor repair path, not a long-term public verb.

## What should survive

Across reopen, reconnect, and refresh, Acepe should preserve:

- transcript history,
- operation lifecycle and evidence,
- linked interactions,
- runtime identity/state needed to continue the session,
- capabilities and telemetry that are part of canonical envelopes.

## Restore model

The intended restore sequence is:

1. load provider-owned persisted session history and translate it into the canonical session graph,
2. register the session locally,
3. apply buffered canonical envelopes in revision order,
4. let live transport updates improve freshness without replacing authority.

The important normalization rules are:

- persisted `Ready` cold-opens as `Detached { restored_requires_attach }`
- persisted `Activating` or `Reconnecting` cold-open as `Detached { abandoned_in_flight }`
- irrecoverable restore faults cold-open as `Failed`
- `Archived` stays `Archived`

That means cold-open is always **history-first**, never fake-live.

## Recovery flow

```text
cold open
  |
  v
canonical restored state
  |
  +--> Detached { reason } -- resume --> activation path --> Ready
  |
  +--> Failed ------------- error handling / retry when canonically allowed
  |
  +--> Archived ----------- read-only
```

For live disconnects:

```text
Ready -> Reconnecting -> Ready
                   \
                    +-> Detached { reconnect_exhausted } -> resume -> Ready
```

If auto-recovery exceeds policy bounds, the UI must have a canonical stop-waiting/manual recovery path instead of spinning forever.

## What should not happen

Reconnect/resume should not require:

- reconstructing current tool state from transcript rows,
- guessing blocked state from whether a prompt is visible,
- depending on the live registry as the only source of runtime truth,
- provider-specific policy hidden in presentation metadata,
- raw transport events finalizing durable state independently,
- reopening a previously live session as if it were already `Ready`.

## Agent-agnostic rule

Provider-specific reconnect behavior is allowed at the adapter edge, but the shared architecture should still speak in the same concepts:

- session graph,
- session lifecycle,
- operations,
- interactions,
- revisioned envelopes,
- canonical runtime state.

That is how Acepe stays agent-agnostic while still supporting provider-specific transports and policies.

## Practical check

When a reconnect/resume bug appears, ask these questions in order:

1. Which canonical state should have survived?
2. Where is that state supposed to live?
3. Did the backend fail to project/persist it?
4. Did the frontend fail to hydrate/apply it?
5. Did a raw event path incorrectly become an authority path?

That sequence usually finds the real bug faster than debugging the surface symptom in the UI first.

For the full lifecycle state machine and command flow, see [Session lifecycle](./session-lifecycle.md).
