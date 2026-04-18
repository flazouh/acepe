---
title: Provider-owned semantic tool pipeline
date: 2026-04-18
category: architectural
---

# Provider-owned semantic tool pipeline

## Intent

Tool-call meaning is owned by **provider reducers** (`acp/reconciler/providers/`) plus shared **provider-agnostic signals** (`classify_signals`). The desktop wire contract is produced once via **`reconciler::projector`**: `SemanticToolRecord` → `ToolArguments` (and derived `ToolKind` metadata).

Streaming deltas must not invent a parallel classifier: they use **`semantic_transition`**, which wraps `providers::classify` and **`projector::transition_from_classification`**, matching non-streamed behavior.

## Boundaries

| Layer | Responsibility |
|-------|------------------|
| `reconciler/providers/` | Provider name tables and `AgentType` dispatch only |
| `reconciler/classify_signals.rs` | Shared heuristics (argument shape, kind hint, title, unclassified payload) |
| `reconciler/projector.rs` | Deterministic semantic → wire projection |
| `reconciler/session_tool.rs` | Live parser-aware identity + typed parse (still orchestrates hints) |
| `streaming_accumulator.rs` | Delta accumulation, throttling, JSON parse; classification via `semantic_transition` |
| `projections/mod.rs` | Session/operation snapshots from **already projected** tool calls — not re-classification |
| `task_reconciler.rs` | Parent/child assembly on `ToolCallData` (future: semantic graph earlier) |

## Frontend

Desktop UI switches on **projected payload** and TS registries; `AgentToolKind` includes `sql` and `unclassified` where the shared UI union allows.

## Replay / import

JSONL and converters should prefer **`classify_serialized_tool_call`** / **`classify_raw_tool_call`** so replay matches live classification. Further unification routes through the same `semantic_transition` pattern where raw frames match the streaming path.

## Related

- Plan: `docs/plans/2026-04-18-002-refactor-provider-owned-semantic-tool-pipeline-plan.md`
- Practice: `docs/solutions/best-practices/deterministic-tool-call-reconciler-2026-04-18.md`
