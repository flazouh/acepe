# Lossless Session Failure Presentation

## Goal

Acepe must show the most useful provider failure immediately and preserve safe diagnostic context end to end. Generic labels such as `Request error` may classify a failure, but must never replace the provider's actual message or error name.

## Architecture decision

`SessionStateGraph.activeTurnFailure` remains the single authority for failures that happen during a turn.

```text
provider error event
  -> Rust provider adapter (extract + sanitize)
  -> canonical TurnErrorInfo
  -> Rust TurnFailureSnapshot / SessionStateGraph
  -> TypeScript canonical projection
  -> presentational error-card props
  -> @acepe/ui card
```

There will be no OpenCode-specific repair in TypeScript and no fallback read from transient panel state for a canonical turn failure.

## Canonical failure contract

Widen the provider-neutral turn failure contract so it can carry:

- `message`: a normalized plain-text string, at most 240 characters, and the first textual node in the alert.
- `details`: an optional, already-sanitized plain-text string, at most 8 KiB, supplied by the Rust adapter.
- `code`: an optional normalized provider error identifier as text, at most 120 characters, because real provider codes are not always numeric. Deserialization accepts historical numeric codes and normalizes them to text.
- `kind`: recoverable or fatal.
- `source`: transport, process, JSON-RPC, or unknown.

Primary-message precedence is deterministic: nested `data.message` → `error.message` → top-level `message` → `error.name` → provider-neutral fallback. Empty values are ignored. Identical message and code values are not repeated.

Provider-controlled values must enter the contract through one canonical Rust sanitizer/constructor. It uses an allowlist of diagnostic fields (`name`, `code`, `type`, `status`, `message`, `cause`) and drops unknown fields, session identifiers, request/prompt/body content, headers, cookies, environment maps, paths, URLs, and credential-shaped keys. It bounds depth (4), object fields (16), array items (16), individual strings (2 KiB), and final output (8 KiB); strips ANSI, bidi, and non-whitespace control characters; and appends an explicit truncation marker. Provider diagnostics are inert escaped text, never HTML, Markdown, or auto-linked content.

Only this bounded sanitized representation enters canonical state, journals, snapshots, reopen hydration, exports, or issue-report drafts. Raw provider payloads never do. Issue creation continues through the existing editable draft/preview and must not send automatically.

OpenCode `session.error` is classified as source `unknown` unless its schema proves transport, process, or JSON-RPC provenance. A valid session identity is required before canonical mutation; missing, empty, mismatched, or unknown session ids are rejected rather than applied to the active panel implicitly.

## Implementation slices

### 1. OpenCode error normalization

- Update the existing name-only characterization test so the new expectation fails first.
- Extend the existing nested-message test to assert sanitized detail and textual code.
- Add a normalization matrix for null, scalar, empty, malformed, top-level, nested, and conflicting message/name/code shapes.
- Add adversarial sanitizer tests for nested credentials, request content, headers/cookies, HTML/script text, ANSI/bidi controls, huge strings, deep objects, and oversized arrays.
- Normalize the event into a provider-neutral `TurnErrorInfo` without discarding the error name or sanitized error object.
- Reject unscoped or mismatched session errors, and classify unproven OpenCode failures as source `unknown`.

### 2. Canonical projection widening

- Add `details` to `TurnErrorInfo`, `TurnFailureSnapshot`, generated TypeScript bindings, and `ActiveTurnFailure`.
- Widen `code` to text throughout the canonical pipeline.
- Add a projection test proving `message`, `details`, `code`, `kind`, and `source` survive a `TurnError` update.
- Add journal/snapshot/open-header hydration round-trip coverage, including historical numeric codes.
- Add canonical acceptance tests for duplicate errors, error-after-complete, late error-after-retry, and failure clearing/replacement. An older or unscoped error must never overwrite a newer accepted turn outcome.
- Update existing constructors explicitly; do not add a second failure store.

### 3. Error presentation

- Pass canonical details through the existing agent-panel presentation model.
- Exact DOM order is: primary provider message → optional short classification → actions → collapsed `Technical details` disclosure.
- Render the card as `role="alert"` with only the concise primary message in its live announcement; do not move keyboard focus automatically.
- Put non-duplicated source/code/diagnostic payload in a collapsed-by-default native `<details>/<summary>` disclosure below the actions so expanded state is exposed by built-in semantics. Use a capped scroll region and `overflow-wrap:anywhere`; never pass provider diagnostics to `detailsHtml`.
- Keep retry, dismiss, and issue-report actions available.
- Retry is primary only for recoverable failures, has a deduplicated busy state, and keeps the accepted failure visible until canonical state replaces it. Dismiss is quiet and does not delete persisted diagnostics. Issue reporting remains an editable, user-confirmed draft.
- Keep `@acepe/ui` presentational; it must not import desktop stores or provider logic.
- Add a DOM test asserting content order and accessible error semantics.

### 4. Real-app verification

- Run focused Rust and frontend tests.
- Run `bun run check` after TypeScript/Svelte changes.
- Add stable QA selectors for the alert, primary message, actions, and technical-details disclosure.
- Run the Acepe QA wrapper against a fresh dev build: doctor, create a new post-build failure with a unique marker (or deterministic fixture), observe, inspect each selector, exercise disclosure and retry, and capture a screenshot.
- Confirm the first text node under the alert is the provider failure (`UnknownError` for the current OpenCode reproduction), details are collapsed initially, and long/unbroken diagnostic text stays bounded.

## Files expected to change

- `packages/desktop/src-tauri/src/acp/session_update/types/interaction.rs`
- `packages/desktop/src-tauri/src/acp/opencode/sse/conversion.rs`
- `packages/desktop/src-tauri/src/acp/opencode/sse/tests.rs`
- `packages/desktop/src-tauri/src/acp/projections/types/session.rs`
- `packages/desktop/src-tauri/src/acp/projections/helpers.rs`
- projection, journal/snapshot/hydration tests, and all explicit `TurnErrorInfo` constructors affected by the ingress code widening
- generated `packages/desktop/src/lib/services/session-update-types.ts` and `packages/desktop/src/lib/services/acp-types.ts` via `cargo test --lib session_jsonl::export_types::tests::export_types` (never hand edit generated output)
- `packages/desktop/src/lib/acp/types/turn-error.ts`
- `packages/desktop/src/lib/acp/types/error-message.ts`
- `packages/desktop/src/lib/acp/store/envelope-reducer/projection-turn-failure.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/state/agent-panel-session-controller.svelte.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/connection-ui.ts`
- `packages/ui/src/components/agent-panel/agent-error-card.svelte`
- focused Rust, TypeScript, and DOM tests

## Constraints

- Preserve the Rust-owned canonical authority.
- Do not serialize secrets or entire untrusted request bodies into UI errors.
- Do not use `any`, `unknown`, TypeScript `try/catch`, object spread for new shapes, or Svelte `$effect`.
- Preserve unrelated changes in the dirty worktree, especially existing edits in agent-panel and UI files.
- Avoid editing dirty `agent-panel.svelte` and `agent-panel-pre-composer-stack.svelte` if the existing prop bridge is sufficient. Before and after work, review scoped diffs for every overlapping file; do not run bulk formatting.
- Do not fix the OpenCode runtime version in this slice; this work makes its failure truthful and actionable.

## Completion criteria

- An OpenCode name-only error is visible as a meaningful primary message.
- Safe provider diagnostics survive canonical state and are available after projection.
- Secret, request, identifier, active-content, control-character, and oversized inputs are removed or bounded before canonical state; raw payloads never reach snapshots, UI props, exports, or issue drafts.
- The primary failure appears exactly once and is visually and semantically the first text in the alert.
- Fresh and reopened sessions preserve the same bounded failure facts, while stale/unscoped errors cannot overwrite a newer turn.
- Focused tests, `bun run check`, and real Tauri DOM/screenshot QA pass.
