# Historical tool operation reconciliation and exact Codex icons

## Status

Reviewed and approved by the user through the explicit “fix it” request.

## Problem

Historical session open can combine provider-owned transcript history with a newer local-journal projection. The current selection chooses the local projection wholesale when its frontier is newer, even if it contains no historical operations. Provider tool transcript rows remain, but their canonical operations disappear. Viewport rows then have empty operation links and render the internal missing-row diagnostic.

The newly imported tool glyphs also need to match Codex’s exact activity icons. Execute must use the extracted `SquareTerminal` vector and preserve its outer SVG stroke presentation.

## GOD authority decision

- Provider history owns historical transcript and operation evidence.
- The local journal owns newer lifecycle/frontier state and locally recorded operations.
- Session open must reconcile these canonical sources in Rust by stable operation/tool-call identity. TypeScript and UI receive one reconciled graph and add no fallback.
- The row ledger must be rebuilt from that reconciled graph; damaged current ledgers require a projection-version bump so they self-heal.

## TDD seams

1. Rust session-open projection reconciliation: when the local projection is newer but lacks provider historical operations, the returned canonical graph retains provider operations linked to provider transcript tool rows.
2. Operation conflict behavior: a local operation with the same canonical identity wins over provider history; provider-only operations are appended in canonical history order.
3. Ledger rebuild: the new projection version invalidates damaged ledgers and persists rows with operation links/display facts.
4. UI icon data: `tool-execute` contains the exact Codex `SquareTerminal` paths/rect and preserved `fill="none"`, `stroke="currentColor"` presentation.
5. Real-app QA: historical Cursor/Claude sessions show tool rows instead of missing diagnostics; execute uses the correct outlined terminal glyph.

## Implementation

1. Add a pure Rust projection reconciler near session-open assembly.
2. Reconcile provider operations/interactions into the newer local projection without replacing local lifecycle/session state.
3. Relink the reconciled operations to the final merged transcript.
4. Bump the transcript row ledger projection version to force self-healing rebuilds.
5. Lock the exact Codex activity glyphs with icon-data tests and central `ToolKindIcon` mappings.
6. Run focused Rust/UI tests, desktop checks, then real Tauri QA against the affected sessions.

## Verification

```bash
cd packages/desktop/src-tauri
CARGO_INCREMENTAL=0 cargo test session_open_snapshot --lib
CARGO_INCREMENTAL=0 cargo test transcript_viewport --lib

cd ../
bun run check

cd ../../ui
bun test ./src/components/icons/__tests__/rounded-icon-data.test.ts
bunx vitest run --config vitest.config.ts src/components/agent-panel/__tests__/agent-tool-execute.svelte.vitest.ts
```

Final QA uses `bun run qa doctor`, opens the affected session, inspects tool rows and `tool-kind-icon-execute`, and captures a screenshot.
