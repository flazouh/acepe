---
title: Use a deterministic provider-side tool-call reconciler
date: 2026-04-18
category: best-practices
module: desktop ACP tool classification
problem_type: best_practice
component: assistant
severity: high
applies_when:
  - provider tool payloads use weak names like "unknown" or generic kind hints like "other"
  - raw tool arguments carry stronger semantic signals than the provider's displayed tool name
  - streaming and non-streaming tool-call paths risk classifying the same logical tool differently
  - the UI is tempted to reclassify or relabel tool calls because backend semantics are incomplete
symptoms:
  - specific tools render as generic cards with labels like Unknown
  - SQL, todo, or question payloads fall through to catch-all Other handling
  - provider-specific name tables drift away from argument-shape heuristics
  - streaming tool input and materialized tool calls disagree about kind or title
root_cause: logic_error
resolution_type: code_fix
related_components:
  - acp/reconciler/session_tool
  - acp/reconciler
  - streaming-accumulator
  - tool-call-ui
  - session-jsonl
tags:
  - reconciler
  - provider-boundary
  - deterministic-classification
  - sql
  - unclassified
  - streaming
  - desktop-acp
---

# Use a deterministic provider-side tool-call reconciler

## Problem

Tool classification had drifted into three partially overlapping layers:

1. provider name normalization,
2. shared payload/title heuristics,
3. frontend fallback rendering.

That architecture failed badly when a provider emitted a weak identity like `name: "unknown"` and `kind: "other"` while the raw arguments clearly described a specific tool. The concrete regression here was Copilot's SQL tool call rendering as **"Mark all done / Unknown"** instead of the todo/SQL-specific UI, because the classifier never promoted `query: "UPDATE todos ..."` into a first-class semantic kind.

## Guidance

Keep classification deterministic and backend-owned.

- **Provider name lookup is only the first signal, not the only one.**
- **Argument shape is authoritative when the name/kind hint is weak.**
- **Fallback must be explicit.** Use a first-class `Unclassified` variant with diagnostics, not a silent `Other`.
- **The UI consumes the semantic union; it does not repair it.**

In practice, the stable precedence is:

1. provider-owned name normalization
2. argument-shape classification
3. ACP kind hint
4. title heuristic
5. `Unclassified { raw_name, raw_kind_hint, title, arguments_preview, signals_tried }`

## What Changed

- Added first-class `Sql` and `Unclassified` variants to the Rust/TS wire contract.
- Extracted shared reconciler pieces into `packages/desktop/src-tauri/src/acp/reconciler/`:
  - `argument_shape.rs`
  - `acp_kind.rs`
  - `title_heuristic.rs`
  - `unclassified.rs`
  - `providers/mod.rs`
- Promoted SQL from a vague payload into typed `Sql { query, description }` arguments.
- Changed classification misses to emit `Unclassified` instead of silently falling back to `Other`.
- Routed streaming normalization through the same provider-aware reconciler utility used for typed argument classification.
- Added per-session streaming-log diagnostics for unclassified tool calls so misses are observable in JSONL without replaying the UI.

## Why This Works

The fix is not "teach the UI a nicer label." The fix is making the backend admit what it knows.

When a provider emits:

```json
{
  "name": "unknown",
  "kind": "other",
  "rawInput": {
    "description": "Mark all done",
    "query": "UPDATE todos SET status='done' ..."
  }
}
```

the backend already has enough evidence to classify it as SQL. If it does not, the UI is forced to guess from presentation metadata and every consumer will guess differently.

A deterministic reconciler fixes that by making the ambiguity boundary explicit. Known tools become typed variants. Unknown tools become `Unclassified` with diagnostics. Nothing silently degrades into a generic `Other` blob.

## Prevention

- Do not add new provider name aliases in frontend rendering code.
- Do not let `ToolKind::Other` absorb classification misses that the backend could explain.
- When a provider introduces a new tool, add it at the provider boundary or argument-shape classifier, not in UI subtitle/title helpers.
- Treat streaming and non-streaming tool input as the same semantic pipeline with different transport timing.
- For every new fallback path, capture the exact failed signals (`signals_tried`) and log them in the session streaming log.

## Regression Coverage

- `packages/desktop/src-tauri/src/acp/parsers/tests/sql_regression.rs`
- `packages/desktop/src-tauri/src/acp/parsers/tests/unclassified.rs`
- `packages/desktop/src-tauri/src/acp/reconciler/mod.rs`
- `packages/desktop/src-tauri/src/acp/reconciler/providers/mod.rs`
- `packages/desktop/src/lib/acp/registry/__tests__/tool-kind-ui-registry.test.ts`

## Related Issues

- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`
- `docs/plans/2026-04-18-001-refactor-tool-call-reconciler-plan.md`
