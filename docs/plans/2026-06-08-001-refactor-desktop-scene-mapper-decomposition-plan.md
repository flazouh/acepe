---
status: completed
type: refactor
created: 2026-06-08
completed: 2026-06-08
god_gate: cleared
---

> **Completed 2026-06-08.** 1,728-line monolith → 24 modules (largest 251 LOC, spine 127).
> Characterization net 30 green; full suite parity with main (same 7 pre-existing
> fails / 5 `runed` errors, +3 new passing tests); typecheck clean; GOD re-scan clean.
> Scene + 4 importers: 183 pass / 0 fail. Committed on `refactor/scene-mapper-decomposition`.

# refactor: Decompose desktop agent-panel scene mapper

Behavior-preserving decomposition of `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts` (1,728 LOC) into small, cohesive, individually-navigable modules composed by a thin spine. **No semantic change.** First of three monoliths (controller and canonical materializer follow).

This plan proves the decomposition methodology established in `CONTEXT.md` + `docs/adr/0001` + the `CLAUDE.md` Architecture section.

---

## Problem Frame

The scene mapper is a single 1,728-line pure projection (desktop domain facts → `AgentPanelSceneModel`). It mixes ~40 functions across tool-status, tool-title, per-tool-kind payload mapping, content extraction, conversation projection, sidebars, composer, strips, and cards. An LLM (or human) must scan the whole file to find any one concern.

**Scope:** this file only. **Out of scope:** the controller, the canonical materializer, any behavior/output change, and any cleanup of provider-shaped types beyond keeping them opaque.

---

## GOD Invariants (must hold — gate cleared on these)

1. **Display identity stays Acepe-owned** — `entry.id` / `options.displayEntryId ?? toolCall.id`. No extracted module invents ids.
2. **No order repair** — the mapper consumes already-ordered `SessionEntry[]`; introduce no `.sort`/`.reverse`/reordering.
3. **Provider-shaped types stay opaque** — `ContentBlock` / `SessionPlanResponse` from `claude-history.js` are already-parsed content; no extracted module grows provider-specific (`agentId === "claude"`) repair logic.

---

## Key Decisions

- **Spine pattern:** `desktop-agent-panel-scene.ts` stays the public entry point and re-exports every currently-exported symbol. The 4 importers (`activity-entry-projection.ts`, `permission-bar.svelte`, `agent-panel-graph-materializer.ts`, `virtual-session-list.svelte`) change nothing. Zero blast radius.
- **Dead code:** `createAttachmentScopedActionId` + `AttachmentScopedBaseActionId` are unused repo-wide and non-exported → dropped during U2 (not carried).
- **One file per tool kind** for the payload mappers (user preference; each kind is a coherent concept). Task description+result share one `task-payload` (same concept). Card builders stay one cohesive `cards` module (one family of trivial shape-builders — splitting them is shrapnel by the deletion test).
- **Recursion stays together:** `mapToolCallEntry` ↔ `mapTaskChildren` are mutually recursive → they live in one `tool-call-entry` module that imports the leaf payload/helper modules.
- **Location:** new modules under `scene/` co-located with the spine.

---

## Output Structure

```text
scene/
├── desktop-agent-panel-scene.ts        # SPINE: buildDesktopAgentPanelScene + re-exports
├── scene-input-types.ts                # Desktop*Input + BuildDesktopAgentPanelSceneOptions
├── tool/
│   ├── tool-status.ts                  # mapToolStatus, hasToolResult
│   ├── tool-title.ts                   # normalizeToolKind, getDefaultToolTitle, resolveToolTitle
│   ├── tool-subtitle.ts                # getWriteBashSubtitle, getToolSubtitle, getToolFilePath
│   ├── tool-read-source.ts             # getReadSource{Excerpt,Highlighter,RangeLabel}
│   ├── tool-result.ts                  # serialize*, getToolResultObject, normalized-result guards
│   ├── tool-call-entry.ts              # mapToolCallEntry, mapTaskChildren, mapToolCallToSceneEntry
│   └── payloads/
│       ├── search-payload.ts
│       ├── fetch-payload.ts
│       ├── web-search-payload.ts
│       ├── browser-payload.ts
│       ├── lint-payload.ts
│       ├── task-payload.ts
│       ├── plan-payload.ts
│       ├── question-payload.ts
│       ├── todos-payload.ts
│       ├── edit-diff-payload.ts
│       └── execute-command.ts
├── assistant-content.ts                # contentBlock(s)ToText, extractAssistantMarkdown
├── conversation-model.ts               # status + entry + virtualized conversation projection
├── plan-sidebar.ts                     # derivePlanItems, buildDesktopPlanSidebar
├── composer-model.ts                   # buildDesktopComposerModel
├── strips.ts                           # buildModifiedFilesStrip, buildPlanHeaderStrip
└── cards.ts                            # buildDesktop{Pr,Worktree,Install,Error}Card
```

The per-unit file lists remain authoritative; the implementer may merge a leaf if the deletion test says it's shrapnel.

---

## Test Strategy

The existing `desktop-agent-panel-scene.test.ts` (27 cases) is the characterization net and exercises the **public interface** — the correct seam for behavior-preserving extraction. It must stay green and unchanged after every unit.

**Gaps to close first (U0):** browser payload, todos payload, and the worktree/install/error card builders are only covered indirectly or not at all. A golden-snapshot characterization test (`desktop-agent-panel-scene.golden.test.ts`) captures the full mapped output of a comprehensive fixture + a full scene with all cards, so *any* drift during extraction fails immediately.

**Verification per unit:** `bun run check` (types) + `bun test` on both scene test files stay green. No edits to the existing test assertions are permitted (changing a test to make extraction pass = behavior change = stop).

---

## Implementation Units

### U0. Harden the characterization net
**Goal:** close coverage gaps before moving code.
**Files:** `scene/desktop-agent-panel-scene.golden.test.ts` (new).
**Approach:** golden-snapshot the full conversation model over a comprehensive multi-kind fixture (incl. browser + todos) and a full scene with pr/worktree/install/error cards. Snapshot is generated green against current behavior.
**Execution note:** characterization-first — this is the safety harness; it lands before any extraction.
**Test scenarios:** Covers browser detailsText (raw-result path), todos field population, and all four card builders inside `buildDesktopAgentPanelScene`. Snapshot equality is the assertion.
**Verification:** both scene test files green.

### U1. Extract input types
**Goal:** move the public input contract to its own module.
**Dependencies:** U0.
**Files:** `scene/scene-input-types.ts` (new), `scene/desktop-agent-panel-scene.ts` (import + re-export).
**Approach:** move the `Desktop*Input` interfaces, `BuildDesktopAgentPanelSceneOptions`, and `MapToolCallEntryOptions`. Spine re-exports the public ones. Pure type move.
**Test scenarios:** none — type-only relocation; net proves no behavior change.
**Verification:** `bun run check` + both test files green.

### U2. Extract tool helpers (status, title, subtitle, read-source, result) + drop dead code
**Goal:** relocate the stateless tool helpers; remove dead `createAttachmentScopedActionId`.
**Dependencies:** U1.
**Files:** `scene/tool/tool-status.ts`, `tool-title.ts`, `tool-subtitle.ts`, `tool-read-source.ts`, `tool-result.ts` (new); spine.
**Approach:** move helper clusters; `tool-call-entry` (U4) will import them. Drop dead code.
**Test scenarios:** none new — exercised via the net.
**Verification:** `bun run check` + net green.

### U3. Extract per-tool-kind payload mappers
**Goal:** one module per tool kind under `payloads/`.
**Dependencies:** U2.
**Files:** the 11 `payloads/*.ts` modules; spine.
**Approach:** move each payload mapper + its kind-local helpers (e.g. `plan-payload` carries `normalizePlanString`/`readStringField`; `edit-diff-payload` carries `normalizeNullableFilePath`; `execute-command` carries `splitExecuteCommandSegments`).
**Test scenarios:** none new — each kind already covered by net.
**Verification:** `bun run check` + net green.

### U4. Extract the tool-call entry assembler
**Goal:** the recursive assembler in one module importing the leaves.
**Dependencies:** U2, U3.
**Files:** `scene/tool/tool-call-entry.ts` (new); spine re-exports `mapToolCallToSceneEntry`.
**Approach:** move `mapToolCallEntry` + `mapTaskChildren` + `mapToolCallToSceneEntry` together (mutual recursion).
**Test scenarios:** none new.
**Verification:** `bun run check` + net green.

### U5. Extract assistant-content + conversation-model
**Goal:** relocate text extraction and the conversation projection (incl. the lazy Proxy view).
**Dependencies:** U4.
**Files:** `scene/assistant-content.ts`, `scene/conversation-model.ts` (new); spine re-exports the exported conversation functions.
**Approach:** move `contentBlock(s)ToText`/`extractAssistantMarkdown`, then `mapSessionStatusToSceneStatus`, `mapSessionEntriesToConversationModel`, `createMappedConversationEntriesView`, `toArrayIndex`, `mapSessionEntryToConversationEntry`, `mapVirtualizedDisplayEntryToConversationEntry`.
**Test scenarios:** none new — conversation/virtualized/status all covered by net.
**Verification:** `bun run check` + net green.

### U6. Extract sidebar, composer, strips, cards
**Goal:** relocate the remaining builders.
**Dependencies:** U5.
**Files:** `scene/plan-sidebar.ts`, `scene/composer-model.ts`, `scene/strips.ts`, `scene/cards.ts` (new); spine re-exports.
**Approach:** move `derivePlanItems`+`buildDesktopPlanSidebar`, `buildDesktopComposerModel`, the two strip builders, the four card builders.
**Test scenarios:** none new — covered by net (incl. U0 card coverage).
**Verification:** `bun run check` + net green.

### U7. Final spine + cohesion pass
**Goal:** confirm the spine reads as a table of contents; verify module sizes and the deletion test on any borderline leaf.
**Dependencies:** U6.
**Files:** spine; merge any shrapnel leaf flagged by the deletion test.
**Test scenarios:** none new.
**Verification:** `bun run check`, full `bun test` (not just scene files), `cargo clippy` unaffected. Re-run GOD scan (no provider branching / order repair / invented ids introduced).

---

## Risks

- **Lazy Proxy conversation view (U5)** is subtle (a `Proxy` over a target array that maps on access). Move verbatim; the "does not eagerly rebuild" test guards it.
- **Snapshot brittleness (U0):** the golden snapshot captures incidental output shape. Acceptable — its job is to fail on *any* drift during this refactor; it can be retired or tightened after U7.
- **Import cycles:** `tool-call-entry` imports many leaves; leaves must not import back. Keep leaves dependency-free of the assembler.
