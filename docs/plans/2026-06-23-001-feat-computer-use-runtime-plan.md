---
status: active
origin: https://github.com/flazouh/acepe/issues/214
created: 2026-06-23
type: feat
depth: deep
---

# feat: Add canonical computer-use runtime

## Problem Frame

Acepe needs first-class computer use so agents can inspect and operate desktop UI. This must not become a loose external tool that dumps screenshots and raw accessibility trees into the transcript.

The product truth must stay in Rust-owned canonical data:

```text
sidecar raw OS data -> Rust canonical computer runtime -> operation graph + interaction graph -> UI/model projection
```

This plan implements the architecture from issue #214 and `docs/concepts/computer-use.md`.

## Scope

Build the first vertical slice around a deterministic Rust runtime, a mock provider for tests, and a native macOS provider for the first production platform. The mock slice proves the protocol, IDs, epochs, operation attachment, and permission blocking; the macOS slice proves the runtime can use Accessibility and Screen Recording without moving product truth out of Rust.

In scope:

- Acepe-owned MCP producer contract for the computer tool
- `ToolKind::Computer`
- typed computer action arguments
- typed compact observation/diff result
- Rust-side canonical element IDs and snapshot epochs
- stale epoch rejection
- permission blocking through interactions
- operation graph attachment
- model-facing compact projection rules
- tests for all core state transitions

Out of scope for this slice:

- full macOS Swift helper or separate sidecar process
- Windows UI Automation
- Linux AT-SPI
- inline screenshots in model output
- Svelte-owned computer state
- coordinate-first action targeting

## GOD Architecture Check

Authority surface:

| Surface | Classification | Decision |
| --- | --- | --- |
| Sidecar raw accessibility nodes | provider-metadata | input only |
| Raw platform handles | provider-metadata | never durable identity |
| Computer element IDs | canonical-owned | Rust runtime owns |
| Snapshot epochs | canonical-owned | Rust runtime owns |
| Computer action lifecycle | canonical-owned | operation graph owns |
| Computer permissions | canonical-owned | interaction graph owns |
| Screenshot bytes | local artifact reference | file-backed reference only, not normal transcript output |
| UI display of computer actions | presentational | derived from operation snapshots |

Forbidden implementation shortcuts:

- no TypeScript provider branches for macOS vs browser vs future Windows,
- no UI stale-state repair,
- no raw OS handle in a durable action target,
- no full accessibility tree after every action,
- no screenshot bytes in ordinary tool results,
- no second operation store for computer use.

## Architecture Decision

Use a Rust-owned computer runtime with thin platform sidecars.

Chosen flow:

```text
Acepe-owned computer MCP tool call
  -> ToolArguments::Computer
  -> Rust ComputerRuntime
  -> ComputerProvider trait
  -> mock provider for tests, native macOS provider in production
  -> canonical ComputerObservation
  -> OperationSnapshot computer payload
  -> InteractionSnapshot if blocked
  -> compact projection for model/UI
```

Why:

- Rust already owns operations and interactions.
- MCP is the right producer because providers already understand tool calls and Acepe can register one owned tool surface per session/project.
- Provider intercept is rejected as the primary path because it would couple behavior to provider naming quirks.
- Sidecars are best kept as OS primitive adapters.
- The expensive part is observation, so Rust should control diffs and output size.
- Deterministic tests stay on the mock provider while native macOS is wired behind the same `ComputerProvider` trait.

## Producer Contract

The first integration mode is an Acepe-owned MCP tool, not a provider-specific intercept and not a UI-only Tauri command.

Target tool shape:

```text
server: acepe_computer
tool: act
input:
  v: click | type | key | scroll | drag | observe
  t: e_...
  e: s_...
  b?: boolean
  s?: boolean
```

Rust remains the executor. The MCP layer is only the agent-facing door into the runtime.
The compact MCP keys are a wire protocol only; Rust maps them to canonical
`verb`, `target_id`, `epoch`, `include_bounds`, and `include_screenshot` fields
before runtime/projection logic.
The same rule applies to compact output keys (`e`, `env`, `els`, `c`, `sr`,
`err`): Rust parses them back into canonical operation payload fields before the
UI sees them.

This means implementation must answer two practical questions before Unit 2:

- where Acepe registers project/session-scoped MCP tools for agents,
- how the MCP handler calls `ComputerRuntime` and emits the result back through the normal provider tool update path.

## Approach Comparison

| Approach | Performance | Token cost | Architecture fit | Risk | Decision |
| --- | --- | --- | --- | --- | --- |
| Copy Orca directly | Good native speed | Can be compact, but not Acepe-shaped | Weak: state would live outside canonical graph | High drift risk | Reject |
| External MCP/plugin tool | Depends on tool | Often verbose unless wrapped | Medium only if Rust wraps it | Medium | Optional adapter later |
| Browser-only automation | Good for web demo | Compact possible | Incomplete for desktop | Medium | Test/demo slice only |
| Rust runtime + thin sidecars | Best control | Best default compactness | Strong | More upfront work | Choose |

## Implementation Units

### Unit 1: Computer protocol types

Files:

- `packages/desktop/src-tauri/src/acp/session_update/types/tool_calls.rs`
- `packages/desktop/src-tauri/src/acp/parsers/arguments.rs`
- `packages/desktop/src-tauri/src/acp/reconciler/session_tool.rs`
- generated TypeScript types under `packages/desktop/src/lib/services/`

Work:

- Add `ToolKind::Computer`.
- Add `ToolArguments::Computer`.
- Define action fields: `verb`, `target_id`, `epoch`, and optional output flags.
- Keep raw provider fields in diagnostic input only.
- Treat `computer` kind hints as canonical, but avoid broad provider-name interception until the Acepe MCP producer is wired.

Tests:

- `packages/desktop/src-tauri/src/acp/session_update/types/tool_calls.rs` round-trip test for computer arguments.
- parser tests for compact computer action fields.
- producer-specific classification tests only after the Acepe MCP tool name is implemented.

### Unit 2: Canonical computer runtime model

Files:

- `packages/desktop/src-tauri/src/computer_use/mod.rs`
- `packages/desktop/src-tauri/src/computer_use/types.rs`
- `packages/desktop/src-tauri/src/computer_use/ids.rs`
- `packages/desktop/src-tauri/src/computer_use/runtime.rs`
- `packages/desktop/src-tauri/src/computer_use/mock_provider.rs`

Work:

- Define `ComputerProvider` trait.
- Define typed raw provider input and canonical normalized output.
- Generate stable element IDs from identity-only facts, namespaced by focused
  app/window scope. Mutable values, labels that behave like state, enabled
  state, and focus state belong in fingerprints, not ids.
- Generate snapshot epochs.
- Reject stale actions before calling the provider.
- Return compact diffs by default: first observe may return the compact `els`
  list; action results return changed elements only plus `c` changed ids and
  compact app/window/focus/busy `env` facts.

Tests:

- stable IDs stay stable when unchanged siblings move.
- epoch changes after mutation.
- stale epoch returns a typed stale error and reobserve suggestion.
- default output excludes bounds and screenshot references.
- expanded output includes requested fields only.

### Unit 3: Operation graph attachment

Files:

- `packages/desktop/src-tauri/src/acp/projections/types/operation.rs`
- `packages/desktop/src-tauri/src/acp/projections/operations.rs`
- `packages/desktop/src-tauri/src/acp/projections/registry.rs`
- `packages/desktop/src-tauri/src/acp/session_state_engine/`

Work:

- Add `computer_payload: Option<ComputerOperationPayload>` to `OperationSnapshot`.
- Attach action input, compact diff output, app/window/focus/busy environment
  facts, settle timing, and stale/permission errors to the operation.
- Keep provider status as provenance only.

Tests:

- a running computer action becomes a running operation.
- a successful action becomes completed with a compact computer payload.
- stale action becomes degraded or failed with a structured computer error.
- operation snapshots do not include raw sidecar handles.

### Unit 4: Permission interactions

Files:

- `packages/desktop/src-tauri/src/acp/projections/types/interaction.rs`
- `packages/desktop/src-tauri/src/acp/projections/interactions.rs`
- `packages/desktop/src-tauri/src/computer_use/permissions.rs`

Work:

- Widen the interaction graph for locally originated computer permissions.
- Represent missing accessibility/screen permission as canonical local interactions.
- Link blocked computer operations to interaction IDs.
- Let interaction resolution resume or cancel the operation through existing graph logic.
- Do not reuse provider JSON-RPC permission reply handlers for OS permissions.

Tests:

- missing permission creates a blocked operation and pending interaction.
- accepted permission resumes the operation.
- denied permission cancels or fails the operation with a clear reason.
- reconnect/replay keeps the blocked relationship.

### Unit 5: Compact projection and UI display

Files:

- `packages/desktop/src/lib/acp/components/agent-panel/scene/tool/tool-call-entry.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/scene/tool/payloads/computer-payload.ts`
- `packages/ui/src/components/agent-panel/`

Work:

- Render computer action summaries from canonical operation data.
- Display compact environment facts and structured errors.
- Do not display raw trees or screenshot bytes by default.

Tests:

- Vitest mapping test for compact computer payload.
- UI package test proving no Tauri/runtime imports.
- DOM QA only after visible UI work.

## First Implementation Order

1. Add concept doc and this plan.
2. Run `document-review mode:headless` on this plan.
3. Implement Unit 1 with failing tests first.
4. Inspect and decide the exact Acepe MCP registration/handler path.
5. Implement Unit 2 with mock-provider tests.
6. Implement Unit 3.
7. Implement Unit 4 as its own local-interaction widening slice.
8. Implement Unit 5 only after Rust projections exist.

## Verification Plan

Rust:

- `cargo test computer_use`
- targeted ACP projection tests for operation and interaction snapshots
- `cargo clippy` in `packages/desktop/src-tauri`

TypeScript:

- `bun run check` from `packages/desktop`
- targeted Vitest for payload mapping

UI:

- run the Acepe QA wrapper after Unit 5 only:
  - `bun run qa doctor`
  - `bun run qa observe`
  - `bun run qa inspect --selector=<computer-tool-region>`
  - `bun run qa screenshot`

## Resolved Decisions And Future Questions

Resolved in this implementation slice:

- Acepe-owned MCP registration happens in the Claude Code SDK client options through the built-in `acepe_computer` SDK MCP server.
- The MCP handler calls the shared `ComputerRuntime` directly and returns compact JSON text through the normal tool result path.
- Local OS permission gates use `InteractionKind::ComputerPermission` and stay distinct from provider JSON-RPC permission requests.

Future choices that do not block this slice:

- exact macOS sidecar IPC format,
- whether computer output uses TOON text directly or typed JSON plus TOON only at model boundary,
- exact app/window scope approval UX.

## Handoff Notes

The first implementation no longer starts with Swift. It keeps the Rust runtime deterministic, plugs native macOS directly behind the provider trait for the first production slice, and leaves a separate Swift sidecar process as a future packaging/performance decision if the direct FFI boundary becomes too large.
