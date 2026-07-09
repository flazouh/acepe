---
name: god-architecture-check
description: "Pre-flight gate for any Acepe change that touches canonical session state, transcript order, tool operations, provider history parsing, hot state, lifecycle, turn state, activity, capabilities, or UI state derived from agent sessions. Use BEFORE editing code that reads or writes session-shaped data. Also use when the user says 'GOD', 'pure GOD', 'canonical authority', 'is this canonical', 'check this against GOD', 'green architecture', 'fix this dual-system thing', or when planning a migration that removes duplicate state."
argument-hint: "[optional: file path, change description, or area to audit]"
---

# GOD Architecture Check

Acepe must have one clear source of truth for every kind of agent-session data. This skill blocks quick patches that make the UI look right while the model underneath stays wrong.

Run this skill before writing code that touches session state, transcript history, tool calls, provider parsing, or UI projections. Run it again before committing.

## The Green Rule

> Raw provider data is input, not product truth. Rust normalizes provider quirks into canonical facts. TypeScript and `packages/ui` read canonical facts only. No reader fallback. No parallel write. No UI repair pass.

If you catch yourself writing one of these, stop:

- `canonical != null ? canonical.X : hotState.X`
- `agentId === "claude" ? specialCase : normalCase` in TypeScript UI code
- "sort the UI rows so they look right"
- "if the parser got this wrong, patch it in the component"
- "same provider id means same display entry"

The fix belongs upstream: widen or correct the canonical model.

## Canonical Authority Surfaces

Acepe has several authority surfaces. Each one has a clear owner.

| Surface | Owns | Owner | Consumers may do |
|---|---|---|---|
| `SessionStateGraph` | lifecycle, activity, turn state, active failure, terminal turn, capabilities | Rust | Read only |
| Canonical transcript | message order, transcript identity, text/thought/tool row sequence | Rust provider/history adapters | Project to display only |
| Operation graph | tool call state, arguments, result, parent/child tool relationships | Rust | Render from canonical operation data |
| Interaction graph | questions, approvals, blocking user interactions | Rust | Render and submit replies |
| Transient UI state | local animation, click guards, in-progress UI mutation state | TypeScript | Keep local only if truly not product truth |
| `packages/ui` props | presentational data | App layer passes props | Render only |

If a value describes what happened in an agent session, it is product truth. Product truth belongs in Rust-owned canonical data, not hot state and not UI components.

## SessionStateGraph Rule

`CanonicalSessionProjection` (`packages/desktop/src/lib/acp/store/canonical-session-projection.ts`) is the TypeScript projection of Rust-owned `SessionStateGraph`. It is fed by the envelope router (`session-state-command-router.ts` -> `applyXxx` handlers in `session-store.svelte.ts`) from Rust `LiveSessionStateEnvelopeRequest` events.

Canonical session state includes:

- `lifecycle: SessionGraphLifecycle`
- `activity: SessionGraphActivity`
- `turnState: SessionTurnState`
- `activeTurnFailure: ActiveTurnFailure | null`
- `lastTerminalTurnId: string | null`
- `revision: SessionGraphRevision`
- `capabilities: SessionGraphCapabilities` once the widening is complete

`SessionTransientProjection` may keep only truly local fields:

- `acpSessionId`
- `autonomousTransition`
- `statusChangedAt`
- `modelPerMode`
- `usageTelemetry`
- `pendingSendIntent`
- `localPersistedSessionProbeStatus`
- `capabilityMutationState`

Forbidden in hot state:

- `status`
- `isConnected`
- `turnState`
- `activity`
- `connectionError`
- `activeTurnFailure`
- `lastTerminalTurnId`
- `currentModel`
- `currentMode`
- `availableCommands`
- `availableModels`
- `availableModes`
- `modelsDisplay`
- `providerMetadata`
- `autonomousEnabled`
- `configOptions`

## Transcript And Message Order Rule

Transcript order is canonical product truth. It must not be guessed in the UI.

Provider history parsers must normalize raw provider rows into ordered semantic transcript facts before anything projects display entries.

Correct flow:

```text
Provider raw history
        |
        v
Rust provider/history adapter
        |
        v
Canonical transcript facts
        |
        v
Canonical session graph
        |
        v
Pure display projection
        |
        v
UI props
```

Wrong flow:

```text
Provider raw history
        |
        v
Parser guesses display rows
        |
        v
UI repairs bad order
```

### Identity Rules

Provider ids are metadata unless the canonical model says otherwise.

For Claude Code:

```text
message.id      = provider assistant container id, metadata only
JSONL uuid      = provider row id
tool_use.id     = actual tool call id
Acepe event_seq = canonical order authority
display_id      = Acepe-owned stable display identity
```

Never use only `message.id` as:

- display row id
- grouping key
- ordering authority
- proof that text and tool calls belong in one visible chat entry

### The Reused Assistant Id Bug

Claude Code can emit multiple assistant JSONL rows with the same `message.id`:

```text
row a-text
  message.id = msg_abc
  content    = assistant text

row a-tool-1
  message.id = msg_abc
  content    = tool_use toolu_111

row a-tool-2
  message.id = msg_abc
  content    = tool_use toolu_222
```

Bad parser behavior:

```text
same message.id -> merge all blocks

merged blocks:
  assistant text
  tool_use toolu_111
  tool_use toolu_222

display:
  assistant
  tool_call
  tool_call
```

That leaves tool calls as the last visible chat entries even though the model-facing assistant text was the meaningful closing message.

Green behavior:

```text
Normalize each provider block/row into canonical ordered transcript facts.
Use tool_use.id for tool identity.
Use Acepe-owned ids for display entries.
Use canonical event order, not provider container id, for display order.
```

Minimum acceptable bug fix:

```text
Only merge same-provider-id assistant fragments when they are compatible text/thinking fragments.
Do not merge tool-use-only fragments into an assistant text fragment.
```

Preferred architecture:

```text
CanonicalTranscriptEvent
+------------------------------------------------+
| session_id                                     |
| event_seq        // strict canonical order     |
| source           // claude_code, codex, cursor |
| provider_row_id  // JSONL uuid / DB row id     |
| provider_msg_id  // msg_abc, metadata only     |
| block_index      // order inside provider row  |
| kind             // user_text / assistant_text |
|                  // assistant_thought / tool   |
| display_id       // Acepe-owned stable id      |
| tool_call_id     // only for tools: toolu_123  |
| payload          // text, args, result, etc.   |
+------------------------------------------------+
```

The display projection is then a pure function:

```text
canonical transcript facts + operation graph -> UI conversation entries
```

## Pre-Flight Checklist

Run this against the proposed change. If any answer is "yes", stop and move the fix upstream.

1. **Are you reading hot state for a canonical field?**
   - Add or use a canonical-only accessor. Do not fall back to hot state.

2. **Are you writing hot state for status, lifecycle, activity, turn state, connection error, model, mode, commands, or capabilities?**
   - Delete the write. Rust must emit the canonical envelope.

3. **Are you adding a fallback like `canonical ?? hotState`?**
   - Forbidden. If canonical is missing, fix the canonical producer.

4. **Are you adding provider-specific branches in TypeScript UI/store code?**
   - Push the provider quirk into the Rust adapter or canonical mapper.

5. **Are you parsing provider history directly into display rows?**
   - Prefer canonical transcript facts first, then pure display projection.

6. **Are you using raw provider message ids as display ids or grouping keys?**
   - Forbidden unless the canonical model explicitly defines that provider id as display identity.

7. **Are you fixing message order in a component, Svelte store, or CSS?**
   - Forbidden. Fix canonical transcript order.

8. **Are you importing Tauri, stores, or desktop runtime APIs from `@acepe/ui`?**
   - Forbidden. `packages/ui` is presentational only.

9. **Are you keeping two systems alive during a replacement?**
   - Forbidden by Acepe architecture. Replace cleanly and remove the old path.

## Output Contract

When invoked, this skill should:

1. Identify the authority surface: `SessionStateGraph`, transcript, operation graph, interaction graph, transient UI, or presentational UI.
2. Classify each touched field or id as `canonical-owned`, `provider-metadata`, `truly-local`, `to-be-widened`, or `must-be-deleted`.
3. List violations: dual-read, dual-write, UI repair, provider branching, raw provider id as display identity, direct provider-history-to-display parsing, or UI-package coupling.
4. Recommend upstream fixes: widen canonical, correct Rust adapter, add canonical transcript facts, use operation graph, add accessor, or delete duplicate state.
5. If violations exist, block work and say: "Plan the canonical widening via `refactor-plan` first. Do not implement reader-level patches."
6. If no violations exist, clear the work with a one-line attestation.

## Examples

### Hot State Fallback

Bad:

```ts
const turnState = canonical != null
  ? mapCanonicalTurnState(canonical.turnState)
  : hotState.turnState;
```

Good:

```ts
const turnState = sessionStore.getSessionTurnState(sessionId);
if (turnState === null) {
  return;
}
```

### Claude Transcript Identity

Bad:

```text
same Claude message.id -> same display entry
```

Good:

```text
Claude message.id -> provider metadata
tool_use.id       -> tool identity
event_seq         -> order authority
display_id        -> Acepe-owned display identity
```

### UI Repair

Bad:

```text
If final entries are tool calls, move latest assistant row to bottom in Svelte.
```

Good:

```text
Fix Rust history parsing so canonical transcript order is correct before UI sees it.
```

## Invocation

Call this skill when:

- Editing `session-store.svelte.ts`, `session-entry-store.svelte.ts`, `session-event-service.svelte.ts`, `session-connection-manager.ts`, `session-messaging-service.ts`, `live-session-work.ts`, `canonical-session-projection.ts`, `session-state-command-router.ts`, `agent-panel-graph-materializer.ts`, or provider/history parsers.
- Editing Rust code that emits session envelopes, parses provider history, builds transcript snapshots, or builds operation snapshots.
- Touching hot state, lifecycle, activity, turn state, connection errors, active turn failure, capabilities, current model, current mode, commands, transcript order, tool calls, or display entry identity.
- The user says "GOD", "green architecture", "canonical", "single source of truth", "provider quirk", "message order", "transcript order", "dual-system", "hot state", or "envelope authority".
- Reviewing a PR that changes any session-shaped or transcript-shaped data path.

## Hard No

- "Just for now" fallbacks.
- UI order repair.
- Provider-specific quirks in TypeScript UI.
- Raw provider ids as product identity without canonical approval.
- Direct provider-history-to-display conversion for new work.
- Parallel hot-state writes for canonical fields.
- `packages/ui` importing Tauri, stores, or desktop runtime APIs.
- Coexistence plans that keep old and new authority paths alive.
