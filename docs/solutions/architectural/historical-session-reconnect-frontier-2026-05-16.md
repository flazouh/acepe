---
module: acp-session-architecture
tags:
  - god-architecture
  - historical-open
  - session-reconnect
  - open-token
  - replay-boundary
problem_type: architecture
status: final
---

# Historical Sessions Must Reconnect After Snapshot Hydration

## Problem

A historical session can show old transcript content and still need a live provider connection.

The broken mental model was:

```text
historical open = read-only snapshot
```

That is wrong for Acepe. A user opening an old thread expects to continue it. If we do not reconnect, the composer can stay disabled, model/mode controls can be stale, stop/send state can be wrong, and the session becomes a museum instead of a usable thread.

## Correct Rule

Historical open has two separate jobs:

```text
1. Restore visible history:
   provider history / disk parser
     -> canonical snapshot
     -> UI

2. Reconnect the thread:
   open token reservation
     -> resume/connect provider transport
     -> only post-frontier live events
```

The snapshot owns already-restored history. The reconnect owns future/live behavior.

## Architecture Invariant

Opening a historical provider-backed session MUST:

- load the provider-owned history from disk through the parser,
- hydrate the canonical snapshot before marking the panel loaded,
- return a claimable `openToken`,
- reconnect with that exact `openToken`,
- keep the panel open request in flight while the token claim is happening, so duplicate opens do not race the token.

Opening a historical provider-backed session MUST NOT:

- skip reconnect,
- make the thread read-only,
- replay old provider transcript content as if it were new live output,
- create unresolved tool rows from live replay when restored operations already exist,
- solve replay bugs by deleting attach/reconnect.

## Why The Token Matters

The backend records a journal frontier, `lastEventSeq`, when it builds the snapshot. It then arms an open-token reservation.

Events after that frontier can be buffered and delivered when reconnect claims the token. Events at or before that frontier must not be delivered again.

In simple words:

```text
old history comes from the snapshot
new changes come from reconnect
the open token separates the two
```

## Correct Fix For Replay Bugs

If historical open shows `Unresolved tool` or duplicated/flashing content after reconnect, do not remove reconnect.

Fix one of these backend seams instead:

- token reservation was not armed,
- token was claimed twice or expired too early,
- replay used the wrong `lastEventSeq` frontier,
- replayed snapshot operations were not reconciled with restored provider-history operations,
- provider parser failed to produce stable transcript-operation links.

## Tests To Keep

Frontend:

- `openPersistedSession` hydrates a found snapshot, marks the session loaded, and calls `connectSession(canonicalSessionId, { openToken })`.
- repeated opens for the same panel are deduped while reconnect is claiming the token.
- alias hydration reconnects the canonical id, not the requested alias.

Backend:

- `session_open_result_from_thread_snapshot` returns a UUID `open_token`.
- the event hub has a reservation for that token and canonical session id.

## Anti-Pattern

This is the architecture violation:

```text
"Replay causes bugs, so historical open should not reconnect."
```

That trades one visible bug for a bigger product break. The clean fix is:

```text
"Historical open reconnects, and replay is bounded by token + frontier + canonical reconciliation."
```
