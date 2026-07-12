# Claude Rich Transcript and Operation Restoration Plan

## Current State

Acepe expands composer-owned `@[text:BASE64]` tokens into provider-facing
`<pasted-content>` text before dispatch. Claude Code persists only that expanded
text, while the Claude history scanner records an empty `pasted_contents` map.
Restoration therefore projects the pasted body as ordinary user text.

Claude Code history retains rich tool arguments, including Skill names,
`Agent` descriptions and `subagent_type`, but restored operations can reach the
display projection with only generic `Skill`/`Task` presentation. Claude Code
2.1.207 emits `TaskCreate` and `TaskUpdate` in the captured trace; the Claude
normalization table currently recognizes only `TodoWrite` as a Todo operation.
`TaskList` and `TaskGet` are outside this bug-fix slice until captured payloads
prove their canonical semantics.

## Target State

Rust owns four canonical facts consistently across live submission and restored
Claude history:

1. Pasted text is a structured user-message attachment with a stable display
   representation, while the provider still receives the expanded text it
   needs.
2. Skill operations retain their requested skill name and arguments.
3. Raw Claude `TaskCreate` and `TaskUpdate` calls normalize into the canonical
   Todo family; raw Claude `Agent` and `Task` subagent calls remain in the
   canonical Task family.
4. Raw Claude `Agent` operations retain description, subagent type,
   parent/child links, and materialize as Task cards.

TypeScript remains a pure canonical-to-scene projection. There will be no
Claude-specific UI branch, raw-history parsing in TypeScript, or fallback from
canonical data to provider payloads.

## Confirmed Public Test Seams

1. Prompt submission plus session restoration -> canonical transcript snapshot.
2. Claude raw tool call -> canonical operation snapshot.
3. Claude task-management tool names -> canonical Todo state/operation snapshot.
4. Claude subagent history -> canonical parent Task operation with linked child
   operations and task-card scene data.

## Affected Files

| File or area | Change type | Purpose and dependencies |
|---|---|---|
| `packages/desktop/src-tauri/src/acp/attachment_token_expander.rs` and prompt dispatch boundary | modify | Separate provider-facing expansion from canonical composer attachment facts. |
| `packages/desktop/src-tauri/src/acp/transcript_projection/` | modify | Represent structured pasted-content facts in the canonical transcript. |
| `packages/desktop/src-tauri/src/session_jsonl/parser/full_session.rs` | modify | Restore Claude user/tool rows without flattening recoverable pasted content. |
| `packages/desktop/src-tauri/src/session_converter/fullsession.rs` | modify | Materialize restored Claude transcript and rich operation arguments through the canonical reconciler. |
| `packages/desktop/src-tauri/src/acp/reconciler/providers/claude_code.rs` and shared classification inputs | modify | Normalize raw Claude `TaskCreate`/`TaskUpdate` as canonical Todo and raw `Agent`/`Task` as canonical Task. |
| `packages/desktop/src-tauri/src/acp/session_update/types/tool_calls.rs` and generated `packages/desktop/src/lib/services/acp-types.ts` | modify/generated if required | Add stable optional canonical Todo identity/update targeting only if the lifecycle red test proves the existing contract cannot fold Claude updates correctly. |
| `packages/desktop/src-tauri/src/acp/projections/` and session materialization tests | modify if required | Preserve operation arguments, parent links, normalized todos, and source links. |
| `packages/desktop/src/lib/acp/components/agent-panel/scene/` tests | modify if required | Prove generic canonical scene projection renders rich Skill/Task/Todo facts; no provider branch. |
| `packages/ui/src/components/agent-panel/` | modify only if canonical props already contain the fact but presentation ignores it | Present canonical chip/card props without app or provider logic. |
| Rust fixtures/tests beside the public seams | create/modify | Use a minimized fixture derived from the captured Claude 2.1.207 trace. |

Exact production files will be narrowed during each red cycle; files that do
not need a behavioral change will not be edited.

## Execution Plan

### Phase 1: Captured Fixture and Canonical Contracts

- [ ] Minimize the captured Claude JSONL into independent user-paste, Skill,
      task-management, and subagent cases. Keep only provider fields required by
      the real parser. Add a separate live-submission fixture containing an
      `@[text:BASE64]` composer token; JSONL alone cannot prove submission.
- [ ] Identify whether the canonical transcript already has an attachment
      representation. If not, widen the Rust canonical user-message payload and
      generated IPC contract once; do not add a display-only side channel.
- [ ] Classify fields under the GOD gate:
      - pasted attachment identity/content: canonical-owned
      - Claude XML wrapper and raw tool names: provider metadata
      - skill name, todo items, subagent description/type, operation links:
        canonical-owned
      - chip expansion state: truly local only before submission
- [ ] Verify existing focused Rust and TypeScript tests are green before the
      first red cycle.
- [ ] After a Rust IPC contract change, run
      `cargo test --lib session_jsonl::export_types::tests::export_types` from
      `packages/desktop/src-tauri`, inspect the generated
      `packages/desktop/src/lib/services/acp-types.ts` diff for unrelated user
      changes, then run `bun run check`.

### Phase 2: Vertical TDD Slice — Pasted-Content Chip

- [ ] Red at the live prompt-dispatch seam: an `@[text:BASE64]` input produces
      one structured canonical attachment while the provider request contains
      the exact expanded `<pasted-content>` envelope.
- [ ] Red at the history seam: the captured Acepe-originated Claude row produces
      ordinary user text plus one structured pasted attachment, not a 219-line
      flattened visible message.
- [ ] Green: preserve canonical attachment facts before provider expansion and
      recover a legacy envelope only when the row is Acepe SDK-originated
      (`promptSource = "sdk"`, `entrypoint = "sdk-rust"`) and uses the exact,
      well-formed, non-nested generated grammar. New submissions use persisted
      canonical facts, not this compatibility heuristic.
- [ ] Derive attachment identity from Acepe-owned canonical message identity
      plus attachment ordinal. Test literal non-Acepe rows, malformed, nested,
      and multiple envelopes; ambiguous legacy input remains visible text.
- [ ] Keep the provider request unchanged: Claude still receives the expanded
      content.
- [ ] Verify live and restored snapshots agree on canonical entry id,
      attachment id, visible text, attachment order/count/content, and that
      reconciliation creates no duplicate or replacement entry.

### Phase 3: Vertical TDD Slice — Skill Name

- [ ] Red: feed the captured `Skill` tool call with
      `input.skill = "diagnosing-bugs"` through Claude history conversion and
      assert the canonical operation and scene entry retain that name.
- [ ] Green: preserve the reconciler's structured Skill arguments through
      restored operation materialization.
- [ ] Verify the generic scene mapper produces `diagnosing-bugs` without any
      Claude-specific TypeScript logic.

### Phase 4: Vertical TDD Slice — Claude Task Management

- [ ] Red: replay the captured lifecycle through the public Claude seam:
      `TaskCreate(subject, description, activeForm)` creates a canonical Todo
      item with stable identity; `TaskUpdate(taskId, status)` targets that item
      and changes only supplied fields while preserving the rest.
- [ ] Red at the generic canonical-operation-to-scene seam: the lifecycle
      produces the Todo scene model/label, not a generic Task card.
- [ ] Green: add the provider-owned mappings and argument interpretation needed
      for those captured calls. If the Todo contract cannot represent provider
      task identity, widen it with an optional canonical id and explicit update
      target rather than merging by text or order.
- [ ] Assert raw Claude `Task` and `Agent` remain canonical Task operations.
      `Explore` is a subagent type, not a raw tool name.
- [ ] Stop at the existing Todo public contract: no new Todo UX, persistence,
      lifecycle rules, or inferred state for unsupported payloads. `TaskList`,
      `TaskGet`, deletion, and cancellation require separate captured fixtures.

### Phase 5: Vertical TDD Slice — Subagent Card and Children

- [ ] Red: restore the captured `Agent` call with `subagent_type = "Explore"`,
      description, and child tool rows. Assert one canonical parent Task
      operation, linked child operations, and a task-card scene entry.
- [ ] Green: preserve the parent operation and repair only provider-history
      linking at the Rust adapter/materialization boundary.
- [ ] Link by normalized tool-call id in the canonical operation-linking phase,
      independent of row order. Populate both directions, deduplicate repeated
      rows, and retain an orphan as a top-level degraded operation rather than
      hiding it or fabricating a parent.
- [ ] Test child-before-parent, duplicate child rows, and orphan degradation.
      Assert source links and provenance keys stay stable across reconciliation.
- [ ] Verify the parent remains visible when children are present and after the
      operation completes.

### Phase 6: Review, Cleanup, and Verification

- [ ] Run focused Rust tests after every slice.
- [ ] Run `cargo clippy` in `packages/desktop/src-tauri`.
- [ ] Run `bun run check` and relevant Bun/Vitest tests in `packages/desktop`.
- [ ] Run `code-review`; resolve all actionable findings.
- [ ] Run the QA wrapper against the dev Tauri app:
      `bun run qa doctor`, identify the exact Claude panel/session, exercise or
      restore a fixture-backed session, inspect the transcript/card selectors,
      and capture a screenshot.
- [ ] Use or add a wrapper command that opens provider session
      `e8905a82-30f4-4bb9-a899-68bc75c5c4bf` by stable identity in this checkout.
      Do not target by panel index or use the installed production app.
- [ ] Prove in scoped DOM evidence: pasted chip visible without flattened body;
      Skill name visible; Todo display visible; Explore subagent Task card and
      children visible.
- [ ] Inspect accessible role/name for each chip/card and the existing
      expanded/collapsed relationship exposed by the subagent card.
- [ ] Record a durable solution note covering the Claude 2.1.207 tool vocabulary
      and attachment-restoration boundary.

## Rollback and Recovery

1. Before every edit, inspect the file diff and record the agent-authored hunk.
   If a slice fails, manually reverse only those hunks with `apply_patch`. Never
   use checkout, reset, stash, or whole-file restoration in this dirty worktree.
2. Do not remove provider-facing `<pasted-content>` expansion; if canonical
   attachment widening is blocked, stop rather than changing what Claude sees.
3. Do not map every `Task*` prefix to Todo. Use an explicit provider vocabulary
   so future subagent task tools cannot be silently misclassified.
4. Run generated output only after checking destination files for unrelated
   changes; preserve and mechanically reapply exact user hunks if needed.
5. Preserve the captured fixture so regressions remain reproducible even if the
   local Claude history file changes.

## Risks

- Pasted content is sensitive durable data. Reuse the existing session-scoped
  retention/deletion rules; do not introduce a second unbounded store.
- The live optimistic message and restored history may currently use different
  producers. The test must compare their canonical results to prevent another
  reconnect-only regression.
- `TaskCreate` describes task management while `Task`/`Agent` describes
  subagents. Prefix matching would conflate distinct product concepts.
- Parent/child evidence may live in sidechain rows rather than the parent input.
  Linking must use canonical tool ids and provider row evidence, never visual
  ordering or raw assistant message ids.
- The worktree is already heavily modified. Edits must remain narrow and must
  not rewrite or discard unrelated user changes.

## GOD Attestation

The plan moves provider quirks upstream into Rust-owned canonical transcript and
operation facts. It introduces no dual-read, dual-write, UI repair pass,
provider-specific TypeScript branch, or raw provider id as display identity.
