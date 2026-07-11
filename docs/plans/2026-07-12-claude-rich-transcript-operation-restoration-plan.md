# Claude Rich Transcript and Operation Restoration Plan

## Current State

Acepe expands composer-owned `@[text:BASE64]` tokens into provider-facing
`<pasted-content>` text before dispatch. Claude Code persists only that expanded
text, while the Claude history scanner records an empty `pasted_contents` map.
Restoration therefore projects the pasted body as ordinary user text.

Claude Code history retains rich tool arguments, including Skill names,
`Agent` descriptions and `subagent_type`, but restored operations can reach the
display projection with only generic `Skill`/`Task` presentation. Claude Code
2.1.207 also emits `TaskCreate`, `TaskUpdate`, `TaskList`, and `TaskGet`; the
Claude normalization table currently recognizes only `TodoWrite` as a Todo
operation.

## Target State

Rust owns four canonical facts consistently across live submission and restored
Claude history:

1. Pasted text is a structured user-message attachment with a stable display
   representation, while the provider still receives the expanded text it
   needs.
2. Skill operations retain their requested skill name and arguments.
3. Claude task-management tools normalize into the canonical Todo family;
   subagent tools remain in the canonical Task family.
4. Claude `Agent`/subagent operations retain description, subagent type,
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
| `packages/desktop/src-tauri/src/acp/reconciler/providers/claude_code.rs` and shared classification inputs | modify | Normalize Claude task-management and subagent tool families without conflating them. |
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
      the real parser.
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

### Phase 2: Vertical TDD Slice — Pasted-Content Chip

- [ ] Red: through the prompt/history-to-canonical seam, assert a pasted message
      produces ordinary user text plus one structured pasted attachment, not a
      219-line flattened visible message.
- [ ] Green: preserve canonical attachment facts before provider expansion and
      recover the explicit Claude `<pasted-content>` envelope during history
      restoration when necessary.
- [ ] Keep the provider request unchanged: Claude still receives the expanded
      content.
- [ ] Verify live and restored canonical snapshots agree on visible user text
      and attachment count/content metadata.

### Phase 3: Vertical TDD Slice — Skill Name

- [ ] Red: feed the captured `Skill` tool call with
      `input.skill = "diagnosing-bugs"` through Claude history conversion and
      assert the canonical operation and scene entry retain that name.
- [ ] Green: preserve the reconciler's structured Skill arguments through
      restored operation materialization.
- [ ] Verify the generic scene mapper produces `diagnosing-bugs` without any
      Claude-specific TypeScript logic.

### Phase 4: Vertical TDD Slice — Claude Task Management

- [ ] Red: table-test `TaskCreate`, `TaskUpdate`, `TaskList`, and `TaskGet`
      through the public Claude classification/materialization seam. Assert the
      canonical family is Todo and that normalized todo state is produced when
      payload data supports it.
- [ ] Green: add the provider-owned mappings and argument interpretation needed
      for Claude's current task API.
- [ ] Add a negative assertion that `Task`, `Agent`, and `subagent` remain Task
      operations.

### Phase 5: Vertical TDD Slice — Subagent Card and Children

- [ ] Red: restore the captured `Agent` call with `subagent_type = "Explore"`,
      description, and child tool rows. Assert one canonical parent Task
      operation, linked child operations, and a task-card scene entry.
- [ ] Green: preserve the parent operation and repair only provider-history
      linking at the Rust adapter/materialization boundary.
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
- [ ] Prove in scoped DOM evidence: pasted chip visible without flattened body;
      Skill name visible; Todo display visible; Explore subagent Task card and
      children visible.
- [ ] Record a durable solution note covering the Claude 2.1.207 tool vocabulary
      and attachment-restoration boundary.

## Rollback and Recovery

1. Each slice is independent. If a widening breaks generated contracts, revert
   only that uncommitted slice and keep the prior green slices.
2. Do not remove provider-facing `<pasted-content>` expansion; if canonical
   attachment widening is blocked, stop rather than changing what Claude sees.
3. Do not map every `Task*` prefix to Todo. Use an explicit provider vocabulary
   so future subagent task tools cannot be silently misclassified.
4. Preserve the captured fixture so regressions remain reproducible even if the
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
