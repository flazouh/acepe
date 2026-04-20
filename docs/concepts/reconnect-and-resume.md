# Reconnect and resume

Reconnect and resume are where architecture lies get exposed fastest.

If Acepe has split authority, reconnect/resume will usually show it through:

- missing runtime state,
- lost blocked state,
- duplicated messages,
- incorrect current tool badges,
- prompts that vanish or attach to the wrong thing.

## Principle

Reconnect and resume should restore from **canonical state first**, then layer live runtime/cache data on top where appropriate.

They must not depend on a component remembering local state or on the live process registry being the only place runtime truth exists.

## What should survive

Across reopen, reconnect, and refresh, Acepe should preserve:

- transcript history,
- operation lifecycle and evidence,
- linked interactions,
- runtime identity/state needed to continue the session,
- capabilities and telemetry that are part of canonical envelopes.

## Restore model

The intended restore sequence is:

1. load the stored canonical snapshot,
2. restore runtime state from projection snapshot data,
3. register the session locally,
4. apply buffered canonical envelopes in revision order,
5. let live transport updates improve freshness without replacing authority.

## What should not happen

Reconnect/resume should not require:

- reconstructing current tool state from transcript rows,
- guessing blocked state from whether a prompt is visible,
- depending on the live registry as the only source of runtime truth,
- provider-specific policy hidden in presentation metadata,
- raw transport events finalizing durable state independently.

## Agent-agnostic rule

Provider-specific reconnect behavior is allowed at the adapter edge, but the shared architecture should still speak in the same concepts:

- session graph,
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
