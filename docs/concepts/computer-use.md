# Computer Use

Computer use is Acepe's model for letting an agent inspect and operate desktop UI.

The goal is not just "click things". The goal is to make every action and every observation part of Acepe's canonical graph, so reconnect, review, replay, permissions, and UI rendering stay deterministic.

## Authority Model

Computer use has five layers:

```text
Agent request
  |
  v
Rust computer runtime
  |
  v
Platform sidecar
  |
  v
Rust canonical environment graph
  |
  v
Operation graph + interaction graph + compact model projection
```

Only Rust owns product truth.

| Layer | Owns | Must not own |
| --- | --- | --- |
| Agent/tool input | requested verb, target id, epoch, output flags | raw OS handles, durable identity |
| Platform sidecar | OS calls, raw accessibility nodes, raw screenshots, raw errors | canonical ids, session truth, retry policy |
| Rust computer runtime | element ids, epochs, stale checks, role/state normalization, settle timing | UI rendering details |
| Operation graph | action lifecycle, action args, result summary, parent/child links | permission decisions |
| Interaction graph | accessibility/screen-recording permission gates and user decisions | action result truth |

## Canonical Flow

```text
agent calls Acepe computer MCP tool
  -> ACP provider emits tool call/update
  -> validate permission interaction state
  -> validate target epoch
  -> call platform sidecar
  -> wait for UI to settle
  -> normalize raw OS data into canonical nodes
  -> create snapshot epoch
  -> attach compact result/diff to the operation
```

Acepe should expose computer use through an Acepe-owned MCP tool surface. Providers should see it as a normal tool, but the implementation must route back into Rust's canonical computer runtime. Do not intercept arbitrary provider tool calls by name as the primary architecture.

Actions should return the next observation in the same result. This avoids the expensive pattern of "observe a huge tree, act, observe a huge tree again".

## Compact Protocol

Default action input should be tiny. The MCP wire shape uses compact keys, then
Rust immediately maps them into the canonical `ComputerActionInput` fields:

```text
act:
  v: click
  t: e_4f2
  e: s_912
```

Input key map:

```text
v=verb, t=target_id, e=epoch, txt=text, k=key, dx=delta_x,
dy=delta_y, b=include_bounds, s=include_screenshot
```

Rust validates verb-specific inputs before any provider call: `type` requires
non-empty `txt`, `key` requires non-empty `k`, and `scroll`/`drag` require a
non-zero `dx` or `dy`. Providers should only execute already-valid actions.

Default action output should be a compact diff:

```text
e: s_913
ms: 128
env: {a: Safari, w: GitHub, f: e_91a, b: false}
c: [e_91a, e_55c, e_4f2]
els:
  - {i: e_91a, r: textbox, l: Search}
  - {i: e_55c, r: button, l: Submit}
  - {i: e_4f2, r: button, l: Search}
```

The first `observe` may return the compact element list for orientation. Action
results return only changed elements in `els` plus the changed id list `c`, while
Rust keeps the full latest snapshot internally for target validation and stale
epoch checks.

The default node shape is:

```text
{i, r, l, v?, b:{x,y,w,h}?, en?}
```

Bounds, coordinates, values, children, and screenshots are opt-in. Screenshot
output should be a reference to stored bytes, not inline bytes in normal model
output. Stored screenshot refs must use bounded local retention so repeated
computer-use turns cannot grow an unbounded temp artifact directory.

## Identity And Epochs

Raw platform ids are metadata only.

Acepe element ids should be generated from identity facts only:

- focused app/window scope,
- role,
- native accessibility identifier when available,
- native structural path when no accessibility identifier exists,
- stable ancestor chain,
- accessible name only as a fallback when no structural identity exists.

Mutable UI state must not enter the element id. Text field values, labels that
behave like state, enabled/disabled state, and focus state belong in the element
fingerprint instead. If an element is not stable enough to identify safely, the
runtime should force a fresh observe instead of minting an id from mutable state.

Every observation creates a snapshot epoch. Every action must include the epoch it was based on.

If the epoch is stale, Rust rejects the action and returns a compact reobserve result. The UI must not repair stale computer state.

## Permissions

Permissions are canonical interactions, but OS permissions are locally originated. They are not provider JSON-RPC permission requests.

Examples:

- macOS accessibility permission,
- macOS screen recording permission,
- future Windows UI Automation permission,
- future Linux AT-SPI permission,
- app/window scope approval.

When permission is missing, the operation becomes blocked and links to an interaction. Resolving the interaction lets the operation resume or cancel through the same graph path as other Acepe approvals.

That means implementation must widen the interaction model with a local permission origin before macOS Accessibility or Screen Recording prompts are wired in. The UI still renders from the interaction graph; it just must not pretend a local OS gate has a provider reply handler.

## Approach Comparison

| Approach | Strength | Weakness | Decision |
| --- | --- | --- | --- |
| Copy Orca directly | Proven macOS ideas: AX tree, screenshot, sidecar, app/window listing | Node/Electron-side state would bypass Acepe's canonical graph | Reject |
| External MCP/plugin only | Fast to integrate and easy to swap | Tool output lives outside Acepe's operation/interaction truth unless wrapped | Use only as optional adapter |
| Browser-only automation | Smaller first demo and easier QA | Does not solve native app permissions, OS identity, or screenshot policy | Useful test slice, not the architecture |
| Rust runtime with thin sidecars | Clean ownership, deterministic graph state, token control | More upfront design and tests | Choose |

## Current Slice

The first implementation slice started with a deterministic Rust computer runtime
and a mock sidecar. The current implementation has moved past that into a native
macOS Accessibility provider plus file-backed screenshot references.

Implemented:

- typed computer action and observation protocol,
- `ToolKind::Computer` and `ToolArguments::Computer`,
- Acepe-owned MCP producer contract: `mcp__acepe_computer__act`,
- computer result/diff summaries behind the operation graph,
- local computer permission interactions,
- stale epoch rejection and compact diff tests,
- native macOS Accessibility observation for focused app/window trees,
- native macOS Accessibility-backed click, type, key, scroll, and drag actions,
- Screen Recording permission checks,
- focused-window screenshot capture and stored screenshot references,
- bounded local screenshot retention,
- action settle timing in compact operation output,
- compact environment summaries with app, window, focused target, and busy state,
- shared runtime validation for verb-specific action inputs before provider calls,
- action results that emit changed elements only by default,
- element identity namespaced by focused app/window scope, seeded by native
  accessibility identifier, and falling back to native structural path,
- app/window scope approval that stays separate from target freshness: if focus
  changes after `observe`, an approved scope still returns `computer_scope_changed`
  with `reobserve: true` instead of replaying the old target id.
