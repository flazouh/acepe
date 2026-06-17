---
title: Provider-owned semantic tool pipeline
date: 2026-04-18
category: architectural
refreshed: 2026-06-11
---

# Provider-owned semantic tool pipeline

## Intent

Tool-call meaning is owned by the **tool identity authority** (`acp/reconciler/`). Provider name tables live in `reconciler/providers/` as adapters behind that authority; shared heuristics (`classify_signals`, `kind_payload`) are private implementation. The desktop wire contract is produced once via **`reconciler::projector`**: `SemanticToolRecord` → `ToolArguments` (and derived `ToolKind` metadata).

Streaming deltas must not invent a parallel classifier: they use **`semantic_transition`**, which funnels through the same `classify_with_provider_name_kind` engine as non-streaming paths (promotions defined once in `mod.rs`).

## Boundaries

| Layer | Responsibility |
|-------|------------------|
| `reconciler/mod.rs` (tool identity authority) | **Public entry set** — `classify_raw_tool_call`, `classify_serialized_tool_call`, `semantic_transition`, `infer_kind_from_payload(_for_agent)`, `display_name_for_tool`, `classify_kind_from_provider_name`. Owns precedence contract and post-classification promotions (todo-SQL, web-search, browser). |
| `reconciler/providers/` | Provider name tables and `AgentType` dispatch — **internal adapters** called only from the authority funnel (`providers::classify` / `detect_tool_kind`). |
| `reconciler/classify_signals.rs` | Shared heuristics (argument shape, kind hint, title, unclassified payload) — **private** to the authority. |
| `reconciler/kind_payload.rs` | Payload kind inference and display-name helpers — **private** implementations; parsers reach them only via authority re-exports. |
| `reconciler/session_tool.rs` | Thin callers into the shared funnel for live/serialized tool rows — **no duplicate promotion tree**. |
| `reconciler/projector.rs` | Deterministic semantic → wire projection |
| `streaming_accumulator.rs` | Delta accumulation, throttling, JSON parse; classification via **`semantic_transition` only** (no direct `providers::detect_tool_kind`). |
| `parsers/*` (`ProviderParser::detect_tool_kind`) | Provider-adapter name-table hook for parse-time kind hints and argument shaping — **not** a full-classification bypass; full identity still flows through authority entries at materialization/replay boundaries. |
| `projections/mod.rs` | Session/operation snapshots from **already projected** tool calls — not re-classification |
| `task_reconciler.rs` | Parent/child assembly on `ToolCallData` (future: semantic graph earlier) |

## Public entry routing

| Entry | Typical callers |
|-------|-----------------|
| `classify_raw_tool_call` | Converters, inbound router, `session_update/tool_calls`, permission handler |
| `classify_serialized_tool_call` | History/replay materialization (`session_update/types/tool_calls`) |
| `semantic_transition` | `streaming_accumulator` |
| `infer_kind_from_payload(_for_agent)` | Provider parsers (ACP `kind` hint inference) |
| `display_name_for_tool` / `canonical_name_for_kind` | Parsers, `session_jsonl/display_names` |
| `classify_kind_from_provider_name` | Router hints, cursor session-update enrichment |

## Frontend

Desktop UI switches on **projected payload** and TS registries; `AgentToolKind` includes `sql` and `unclassified` where the shared UI union allows.

## Replay / import

JSONL and converters should prefer **`classify_serialized_tool_call`** / **`classify_raw_tool_call`** so replay matches live classification. Streaming-shaped raw frames route through **`semantic_transition`**.

## Related

- Plan (original): `docs/plans/2026-04-18-002-refactor-provider-owned-semantic-tool-pipeline-plan.md`
- Plan (authority consolidation): `docs/plans/2026-06-11-009-refactor-tool-identity-authority-plan.md`
- Practice: `docs/solutions/best-practices/deterministic-tool-call-reconciler-2026-04-18.md`
