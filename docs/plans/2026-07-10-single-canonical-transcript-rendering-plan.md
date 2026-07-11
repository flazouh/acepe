# Single canonical transcript rendering

## Status

Draft for required document review. Implementation starts only after review findings are resolved and the user confirms the plan.

## Problem

Acepe currently renders persisted transcript rows from two overlapping sources:

1. Rust-authored `TranscriptViewportRow` values, including canonical transcript order and embedded operation/interaction links.
2. TypeScript-materialized `AgentPanelSceneEntryModel[]`, built independently from `SessionStateGraph` transcript and operation arrays.

The viewport renderer prefers a matching scene entry by row id or tool-call id before projecting the embedded canonical viewport operation. If the scene entry was built from earlier or thinner operation evidence, it shadows richer viewport facts. The observed Cursor Read rows prove the split: every persisted viewport row contains `operation.arguments.file_path` and `displayFacts.targetPathSummary`, while the rendered `AgentToolRead` receives no `filePath`.

This violates GOD architecture because two readers independently project the same session truth and precedence, rather than canonical evidence, chooses the result.

## Target architecture

Rust-authored transcript viewport rows are the sole authority for every persisted conversation row:

```text
provider input
  -> Rust canonical transcript + operation + interaction graphs
  -> TranscriptViewportRow with embedded canonical links
  -> one pure TypeScript row-to-presentational projection
  -> AgentPanelSceneEntryModel
  -> @acepe/ui renderer
```

`AgentPanelSceneEntryModel` remains a presentational DTO, not an authority. It may also represent truly local rows that do not describe persisted session history:

- optimistic user input before canonical acknowledgment;
- the local planning placeholder;
- synthetic review row derived from local workspace state; it participates only in the explicit local-row composition contract.

Persisted user, assistant, thought, tool, compaction, and interaction rows must never be resolved from `scene.conversation.entries`, by-id scene maps, or tool-call-id scene maps.

There is no compatibility fallback and no provider-specific UI branch. Old persisted-session rendering paths are removed in the same change.

## Authority classification

| Data | Classification | Owner after change |
|---|---|---|
| transcript row order and display identity | canonical-owned | Rust `TranscriptViewport` |
| tool arguments, results, state, parent/child links | canonical-owned | Rust operation graph embedded in viewport links |
| questions and permissions | canonical-owned | Rust interaction graph embedded in viewport links |
| `AgentPanelSceneEntryModel` | presentational | pure TypeScript projection from one viewport row |
| optimistic user row | truly-local | panel input state until canonical acknowledgment |
| planning placeholder | truly-local | panel animation state |
| synthetic review row | truly-local | workspace review UI state |
| transcript-derived `scene.conversation.entries` | must-be-deleted | replaced by viewport projection |
| scene-entry-by-id/tool-call-id precedence | must-be-deleted | replaced by viewport identity and links |

## Public behavior seams for TDD

The agreed implementation seams are:

1. `resolveTranscriptViewportSceneEntry(row, localRows)` / its replacement: a canonical Read row containing `targetPathSummary` produces a presentational Read entry with `filePath`, even if a stale same-id scene entry is supplied by the old fixture. The red test proves the observed bug before old parameters are removed.
2. `buildRenderedTranscriptViewportRows`: persisted rows are projected only from viewport content and embedded links, while optimistic/planning/review local rows remain renderable and correctly ordered.
3. Agent-panel integration: a viewport Read row reaches `AgentToolRead` and renders its filename badge in the real Svelte component.
4. Rust viewport row tests: operation and interaction display facts remain complete for representative Read, Edit, Execute, Todo, Question, Task, and degraded operations.
5. Table-driven presentational and component coverage: each persisted row family proves one distinctive canonical fact survives through the TypeScript model and, for rich components, the DOM.

Tests are behavioral. No test reads source files or asserts implementation strings.

## Affected files

| File or area | Change | Dependency |
|---|---|---|
| `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-row-mapper.ts` | make canonical viewport rows the only persisted-row input; remove scene-entry precedence | Rust row contract |
| `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-rendered-rows.ts` | remove indexed/by-id scene resolution for persisted rows; compose local-only rows explicitly | row mapper |
| `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` | stop passing canonical conversation scene arrays/maps into viewport row rendering | rendered-row API |
| `packages/desktop/src/lib/acp/components/agent-panel/state/agent-panel-scene-pipeline-controller.svelte.ts` | separate lifecycle/header/local UI projection from persisted transcript rendering | graph materializer cleanup |
| `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts` and conversation cache/dispatcher modules | remove transcript conversation materialization and operation-entry caching once no consumer remains | viewport cutover |
| `packages/desktop/src/lib/acp/session-state/entry-materializers.ts` | retain only helpers still required by direct row projection or delete obsolete transcript materializers | graph materializer cleanup |
| `packages/desktop/src/lib/acp/components/agent-panel/scene/tool/*` | reuse pure operation-to-presentational mapping from embedded operation snapshots; move shared mapper if needed | no second store/authority |
| `packages/desktop/src-tauri/src/acp/transcript_viewport/*` | widen missing canonical display facts only if representative red tests expose gaps | Rust remains authority |
| existing mapper/materializer/viewport tests | replace dual-source expectations with canonical-only behavior | new contracts |
| new component integration fixture/test under agent-panel tests | prove Read filename reaches DOM | final UI behavior |
| `CONTEXT.md` and relevant solution note | document the single authority and removed path | completed implementation |

Before editing any listed file, inspect current dirty changes and do not overwrite unrelated user work. The existing Cursor authentication/icon work and concurrent UI edits are out of scope.

## Local-row composition contract

Local rows are a separate input and never compete with canonical row ids:

1. Local rows render only when the loaded viewport includes the canonical transcript tail. They never appear while the user is viewing an older window.
2. The optimistic user row is owned by the existing pre-session `pendingUserEntry` or session `pendingSendIntent.optimisticEntry`. It is appended after the canonical tail.
3. The optimistic row is removed by the existing pending-send acknowledgment contract: matching canonical `attemptId` first, then a newer transcript revision with matching user text as the established fallback. Rejection and timeout use the existing pending-intent cleanup; no new identity heuristic is added.
4. The planning placeholder follows the optimistic row and is suppressed once a canonical awaiting-model/planning row exists.
5. The synthetic review row follows the planning placeholder and is shown only when its existing workspace-review predicate is true.
6. Deterministic local tail order is therefore: optimistic user -> planning placeholder -> synthetic review. Each row has a `local:` identity namespace and cannot replace a canonical row.

## Streaming presentation contract

Token reveal and thinking/planning timing decorate the canonical viewport-derived presentational entry; they do not provide transcript content or operation semantics.

- `activeStreamingTail`, canonical row version, and segment ids select the row being animated.
- Reveal state is a bounded local cache keyed by `sessionId + rowId + rowVersion`; a version change invalidates the decoration for that row.
- The existing reveal-text/token-reveal behavior is moved behind a per-row decorator called after canonical row projection.
- Tail settle, incremental text reveal, and HMR-friendly stable row identity remain behaviorally covered before the conversation-scene pipeline is deleted.

## Pre-edit gate and dependency audit

Before Phase 1:

1. Run the GOD architecture check and record that transcript/operation/interaction product truth is canonical-owned while reveal/local rows are truly local.
2. Enumerate every production consumer of conversation cache, dispatcher, patch, reveal, and graph materializer APIs.
3. Classify each consumer as persisted-transcript rendering, local decoration, or non-conversation panel state.
4. Delete a module only after every persisted-transcript consumer has moved to viewport rows and any non-conversation responsibility has been extracted. This audit determines the exact deletion set; it does not permit the old transcript reader to remain.

## Execution plan

### Phase 1: Characterize and turn the bug red

1. Add the row-mapper regression using a real-shaped canonical Read viewport row whose embedded operation has `file_path` and `targetPathSummary`, plus an old same-id sparse scene entry. Assert the result contains the filename.
2. Add a rendered-row integration case that covers persisted canonical rows mixed with local optimistic/planning/review rows.
3. Add or extend a Svelte integration fixture so the same canonical Read row renders the filename badge.
4. Add table-driven model/component cases for user, assistant, thought, Edit, Execute, Search, Todo, Question, Task, compaction, and missing/degraded rows. Each case asserts a distinctive canonical fact, not merely the row kind.
5. Run only these tests and record that the Read case fails for the observed reason.

Verification:

```bash
cd packages/desktop
bun vitest run src/lib/acp/components/agent-panel/logic/__tests__/transcript-viewport-row-mapper.test.ts
bun vitest run src/lib/acp/components/agent-panel/logic/__tests__/transcript-viewport-rendered-rows.test.ts
bun vitest run src/lib/acp/components/agent-panel/components/__tests__/transcript-viewport-canonical-rendering.svelte.vitest.ts
```

### Phase 2: Make canonical viewport projection complete

1. Define one pure `TranscriptViewportRow -> AgentPanelSceneEntryModel` projection.
2. Project persisted user, assistant, thought, tool, compaction, missing/degraded, and interaction-backed rows only from row content and embedded canonical links.
3. Reuse pure tool presentation helpers, but do not read operation stores, graph scene arrays, provider ids, or hot state.
4. Widen `TranscriptViewportInteractionLink` to carry canonical question and permission presentation payloads because its current identity/state-only shape cannot render interactions alone. Add Rust tests for every supported interaction kind plus missing/degraded payload behavior, then regenerate TypeScript bindings.
5. If another rich presentation lacks required data, widen `TranscriptViewportOperationDisplayFacts` or the embedded canonical operation in Rust and add the Rust test first. Do not add a TypeScript fallback.
6. Ensure Read paths use canonical `targetPathSummary`/`arguments.file_path`, and verify Edit/Execute/Search/Todo/Question/Task behavior remains intact.

Verification:

```bash
cd packages/desktop/src-tauri
CARGO_INCREMENTAL=0 cargo test transcript_viewport --lib
cd ..
bun run check
```

### Phase 3: Cut the viewport renderer to one persisted-row source

1. Remove `sceneEntries[index]`, `sceneEntryById`, `sceneEntryByToolCallId`, and operation-store resolver precedence for persisted viewport rows.
2. Give local optimistic/planning/review rows the explicit tail-only input, acknowledgment, and ordering rules defined above.
3. Update `scene-content-viewport.svelte` and the panel controller to pass canonical viewport buffers plus local presentation rows only.
4. Move reveal and streaming timing to the viewport-row decorator defined above before removing the old scene conversation pipeline.
5. Turn the Phase 1 tests green one slice at a time.

Verification:

```bash
cd packages/desktop
bun vitest run src/lib/acp/components/agent-panel/logic/__tests__/transcript-viewport-row-mapper.test.ts
bun vitest run src/lib/acp/components/agent-panel/logic/__tests__/transcript-viewport-rendered-rows.test.ts
bun vitest run src/lib/acp/components/agent-panel/components/__tests__/transcript-viewport-canonical-rendering.svelte.vitest.ts
bun run check
```

### Phase 4: Delete the duplicate transcript scene system

1. Remove transcript and operation conversation-entry materialization from `agent-panel-graph-materializer`.
2. Using the pre-edit dependency audit, delete conversation cache/dispatcher/patch modules whose persisted-transcript responsibility has moved. Extract any proven non-conversation responsibility first. Do not leave a dormant transcript fallback.
3. Keep graph materialization only for lifecycle, header, composer, strips, cards, sidebars, chrome, and explicitly local rows—or split those concerns into a smaller non-conversation materializer if the old name becomes misleading.
4. Delete obsolete tests that assert dual-source precedence; replace valuable behavior coverage at the viewport projection seam, including reveal/tail behavior and every persisted row family.
5. Use `rg` and dependency checks to prove removed modules and scene-map resolution functions have no production consumers.

Verification:

```bash
cd packages/desktop
bun run check
bun test
rg -n "sceneEntryByToolCallId|resolveTranscriptViewportSceneEntryCandidate|materializeCachedConversation" src/lib/acp
```

The final `rg` must return no production references; test-only references are removed or deliberately renamed around the new canonical seam.

### Phase 5: Real-app verification

1. Restart the dev app only if Rust changes made the binary stale.
2. Use the repository QA wrapper against the current Cursor session.
3. Inspect all visible Read rows and assert their DOM text contains filenames matching canonical `targetPathSummary` values.
4. Exercise scrolling so rows rematerialized from outside the current viewport retain filenames.
5. Reopen the session and inspect again to cover restored history.
6. Capture a screenshot and confirm no console errors.

Required commands:

```bash
cd packages/desktop
bun run qa doctor
bun run qa observe
bun run qa inspect --selector='[data-tool-kind="read"]' --limit=20
bun run qa screenshot
```

If scrolling/reopen cannot be expressed smoothly through the wrapper, add a focused QA command before repeating the interaction.

### Phase 6: Review and documentation

1. Run GOD architecture check again and confirm no dual read, UI repair, provider branch, or second transcript authority remains.
2. Run code review across the full task-owned diff and resolve findings.
3. Add a durable solution note describing why scene-entry precedence shadowed richer canonical viewport facts.
4. Update `CONTEXT.md` to state that transcript viewport rows plus embedded operation/interaction links are the only persisted conversation rendering input.

Final verification:

```bash
cd packages/desktop
bun run check
bun test
cd src-tauri
CARGO_INCREMENTAL=0 cargo test transcript_viewport --lib
cargo fmt --check
```

## Rollback and recovery

This is a clean replacement, not a runtime coexistence strategy.

- Work in vertical test-backed phases so a failing phase can be reverted by task-owned file diff without touching unrelated dirty files.
- Do not delete duplicate materializer modules until Phase 3 is green and production references are enumerated.
- If a tool kind lacks enough canonical viewport evidence, stop at Phase 2, widen Rust, and keep tests red; do not temporarily restore the old reader.
- If performance regresses, profile the canonical row projection and add memoization keyed by Rust row version. Do not restore the second authority.

## Risks

- Rich tool UIs may depend on fields not currently present in compact viewport display facts. Mitigation: embedded canonical operations remain available; widen Rust facts only where compaction removes required evidence.
- Local optimistic and planning rows currently share arrays with canonical conversation entries. Mitigation: define a separate local-row composition contract before deleting the old materializer.
- Conversation patch modules contain performance optimizations. Mitigation: preserve performance through row-version keyed projection and measure scrolling with the existing QA probes.
- Concurrent dirty changes overlap `packages/ui` and panel files. Mitigation: inspect each target diff before applying patches and avoid unrelated files unless the canonical cutover requires them.
