---
title: "feat: Per-sub-agent activity cards above the composer (model, tokens consumed, context window)"
type: feat
status: active
created: 2026-06-28
depth: deep
god_check: passed (truth upstream — Rust adapter captures sub-agent usage + model; canonical reduction aggregates per parent_tool_use_id; the view layer only renders. No provider-quirk repair in the view.)
related:
  # The session-level cumulative-vs-occupancy fix this plan builds on was done directly
  # (no plan doc): packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs (build_result_telemetry)
  # + packages/desktop/src/lib/acp/store/envelope-reducer/canonical-usage-telemetry.ts (sticky occupancy).
  - docs/plans/2026-06-24-003-fix-assistant-text-delta-revision-gate-plan.md  # revision-gate dormancy class (see U3 risk)
---

# feat: Per-sub-agent activity cards above the composer

## Summary

When a session spawns sub-agents (Claude Code's `Task` tool, and any future provider that nests assistant turns under a `parent_tool_use_id`), render **one row per active sub-agent** in the pre-composer card stack. Each row shows, on the left, the sub-agent's **model name** + title/description; on the right, **two live metrics** — tokens consumed (cumulative effort) and context-window usage (occupancy %).

The crux is that **per-sub-agent usage telemetry is currently discarded in Rust**: `translate_assistant` only emits `UsageTelemetryUpdate` when `parent_tool_use_id.is_none()` ([cc_sdk_bridge.rs](packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs) lines 204 & 326), and the test `assistant_subagent_tool_use_does_not_emit_usage_telemetry` locks that in. This plan **deepens the canonical model** so sub-agent assistant-message usage is captured (not dropped), aggregated per `parent_tool_use_id` into a canonical per-sub-agent telemetry map owned by the reducer, and projected read-only by TypeScript and `@acepe/ui`.

This builds directly on the session-level telemetry pipeline just corrected for the cumulative-vs-occupancy bug (the same input + cache_read + cache_write = occupancy snapshot, sum-of-steps = consumed distinction applies per sub-agent).

---

## Problem Frame

### What exists today

- Sub-agents are modeled canonically as `Task` tool calls (`ToolKind::Task`, `arguments.kind === "think"` with `description` / `subagent_type` / `prompt`), with `parent_tool_use_id` linking a sub-agent's nested tool calls to the parent Task ([tool_calls.rs](packages/desktop/src-tauri/src/acp/session_update/types/tool_calls.rs)).
- `SessionGraphActivity.activeSubagentCount` exists but is only a count — it does not expose *which* sub-agents are active or their usage.
- Sub-agent assistant messages **do** carry a `model` field and a `usage` blob in the cc-sdk stream, but `translate_assistant` drops both for `parent_tool_use_id.is_some()` messages.
- The pre-composer stack ([agent-panel-pre-composer-stack.svelte](packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-pre-composer-stack.svelte)) renders prop-driven cards (PR status, modified files, todos, queue) passed down from [agent-panel.svelte](packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte).
- The session-level telemetry pipeline (Rust `UsageTelemetryData` → `applyTelemetry` command → `buildCanonicalUsageTelemetry` → `SessionUsageTelemetry` in the transient projection → metrics chip) is the pattern to mirror.

### What's missing

1. A canonical, per-sub-agent usage fact (model, cumulative tokens consumed, latest context occupancy, window size) keyed by `parent_tool_use_id`.
2. A producer in the Claude Code adapter that emits it from sub-agent assistant messages instead of discarding them.
3. A resolved **context-window size** for sub-agents (no `model_usage` / `usage_update` arrives for sub-agents).
4. A presentational row component + a desktop controller that joins active Task tool calls to their telemetry and renders the rows only while active.

### Success criteria

- While a turn has active sub-agents, one row per sub-agent appears above the composer, each showing model name + title and two live-updating metrics (tokens consumed, context %).
- Rows disappear when their sub-agent completes / the turn ends (active-only).
- Sub-agent context % never exceeds 100% (same occupancy correctness as the session-level fix).
- Canonical truth lives in Rust; TS/UI only project. No provider-quirk repair downstream.
- Session-level telemetry behavior is unchanged.

---

## Scope Boundaries

**In scope:** canonical per-sub-agent usage map (Rust-owned), Claude Code producer, model→context-window resolution, TS projection + store accessor, `@acepe/ui` row component, desktop controller wiring into the pre-composer stack, active-only lifecycle.

### Deferred to Follow-Up Work

- Per-sub-agent **cost ($)** display — the data (cost) is only on the top-level Result, not per sub-agent; out unless requested later.
- Persisting sub-agent rows / history after a turn ends (we show active-only).
- Wiring producers for non-Claude providers (the canonical model is generic; only the Claude Code producer is built now).
- Nested/recursive sub-agents (sub-agents spawning sub-agents) beyond a single `parent_tool_use_id` level.

### Out of scope

- Any change to session-level context-window semantics (just fixed separately).
- A general model-capability catalog beyond what's needed to resolve a context-window size.

---

## GOD Architecture Compliance

This change touches session-shaped, canonical-projection data, so it runs the GOD gate by construction:

- **Truth upstream:** the per-sub-agent usage map is built in the Rust adapter / reducer from raw provider messages. Raw sub-agent `usage` and `model` are *input*; the canonical per-sub-agent telemetry record is *product truth*.
- **No view-layer repair:** the canonical *reducer* (TS, mirroring the existing session-level `canonical-usage-telemetry.ts`) owns the token aggregation; `@acepe/ui` performs **no** token math or provider-quirk repair — it renders pre-computed numbers. The boundary enforced is "no math/repair in the view layer," consistent with where the session-level builder already lives. The cumulative-vs-occupancy distinction is resolved in the Rust adapter + the canonical reducer, exactly like the session-level path.
- **Identity:** sub-agents are keyed by their canonical `parent_tool_use_id` (the Acepe-owned Task tool-call id), not by raw provider message ids.
- **Activity, not raw counts:** the existing `activeSubagentCount` stays the activity signal; per-sub-agent identity for display comes from active `Task` tool calls joined to canonical telemetry.

---

## High-Level Technical Design

*This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
cc-sdk sub-agent assistant message (parent_tool_use_id = T, model = M, usage = U)
        │  (today: dropped at lines 204/326)
        ▼
Rust translate_assistant → emit UsageTelemetryUpdate with parent_tool_use_id = Some(T)
        │   tokens = per-call breakdown; context_window_size resolved from model M
        ▼
applyTelemetry command (router) ── reduceApplyTelemetry
        │
        ├─ parent_tool_use_id == None  → buildCanonicalUsageTelemetry  → SessionUsageTelemetry (unchanged)
        └─ parent_tool_use_id == Some(T) → buildCanonicalSubagentTelemetry(prev[T], data)
                                              → setSubagentTelemetry patch
        ▼
transient projection: subagentTelemetry: Map<parentToolUseId, SessionSubagentTelemetry>
        ▼
desktop controller: join active Task tool calls (kind==="think", in_progress) ⨝ subagentTelemetry[id]
        ▼
@acepe/ui SubagentActivityRow ×N   (model + title | tokensConsumed chip | context% chip)
```

Key reuse — match the **real** session basis exactly (verified in code), do not invent a new one:
- **occupancy** = the latest sub-agent message's `tokens.total` (= `input + output + cache_read + cache_write`, the same value `build_usage_telemetry_from_json` computes and `getContextUsagePercent` divides by the window) made **sticky**, divided by the resolved window. (Output is included because the session path includes it; mirroring beats diverging. If we later decide occupancy should exclude output, change it in both places together.)
- **consumed** = cumulative effort that must be **replay-idempotent** (see Decision 4 — a naive running sum of per-step totals both re-counts the cached prefix every step and breaks under the revision gate / re-apply, the exact pathologies the session-level fix called out). Its exact definition is an open decision (Decision 4).

---

## Key Technical Decisions

1. **[OPEN — see Open Decision A] Carrying the sub-agent key: extend `UsageTelemetryData` with optional `parent_tool_use_id` vs. a dedicated `SubagentUsageTelemetryUpdate` SessionUpdate variant.** The extend option reuses the whole pipeline but makes mis-routing a runtime-branch risk; a distinct variant makes mis-routing a *type* error. **Whichever is chosen, U1 must guard ALL THREE session-level emission sites** — the error-path emission at cc_sdk_bridge.rs ~line 206 as well as the two at ~204/~326 — and add an invariant test that no session-level record is ever built from a `parent_tool_use_id.is_some()` message.

2. **Per-sub-agent telemetry is a separate canonical record (`SessionSubagentTelemetry`), stored in a `Map<parentToolUseId, …>` on the transient projection** — not nested inside `SessionUsageTelemetry`. Keeps the session-level record untouched and makes active-only pruning a map operation.

3. **Context-window size for sub-agents comes from an explicit, hand-authored, dated model-id→window table — there is NO authoritative catalog for sub-agents.** Sub-agents receive no `model_usage`/`usage_update`, so the provider never tells us their window. The existing `context_window_for_model` is `#[cfg(test)]` and returns a flat 200k for every Claude id (no family distinction, no 1M) — "promoting" it as-is changes nothing. U2 must author a real per-model-id table (including any 1M-context variant, with the gating caveat) and a dated maintenance note. Source priority for a sub-agent row: explicit provider value (rare/none) → model-id table lookup → **null → hide the context chip**. **Do NOT fall back to the session's contextBudget window** — sub-agents frequently run a *different* model than the session (e.g. a Haiku sub-agent under an Opus session, per the existing test fixture), so dividing by the session window yields a wrong %. The budget-source tag (`SessionContextBudgetSource`) is a **TypeScript** union set in the canonical reducer (U3), not a Rust enum; the Rust adapter only carries the resolved window size and whether it was provider-explicit.

3a. **Model name comes from the sub-agent assistant message's `model` field**, captured in Rust and carried on the per-sub-agent record (`sourceModelId`) — not from the Task tool-call args (which have no model). U1/U5 consume this; see Decision 3a referenced in those units.

4. **[OPEN — see Open Decision B] "Tokens consumed" semantics + idempotency.** Occupancy is a sticky snapshot (idempotent on re-apply, like the session path). "Consumed" is the hard part: a naive `consumed += step.total` (a) re-counts the cached prefix every step (the cache-read double-count the session fix called out) and (b) is **not replay-idempotent**, while `applyTelemetry` is gated only by `isNewerGraphRevision` and sub-agent assistant telemetry carries `event_id: None` (so the existing `lastTelemetryEventId` dedup is inert). Both must be resolved together. Candidate definitions: (i) cumulative billed effort incl. cache reads (large numbers; needs per-step idempotent keying), (ii) **net new work** = Σ`output_tokens` + latest input snapshot (output never re-counts; naturally idempotent-ish), (iii) Σ`output_tokens` only. The chosen definition drives the U4 label/tooltip and the U3 accumulation mechanism (including assigning a real per-step id so accumulation is idempotent under replay/same-revision arrival).

5. **Active-only lifecycle: render-gate at the join AND a defined prune patch.** The controller renders a row only for `Task` tool calls currently `in_progress`. The canonical map is **not** allowed to grow unbounded: U3 defines a `clearSubagentTelemetry` (prune) patch wired to turn-complete / turn-cancelled / turn-failed, with a test asserting the map is emptied at turn end (prevents key reuse across turns and unbounded growth). A final sub-agent telemetry event can arrive *after* its Task flips to `completed`; U5 must define whether that last metric is shown or dropped and assert no orphan row / flicker.

---

## Open Decisions (resolve before / during U1–U3)

These two surfaced in document review as genuine judgment calls, not mechanical fixes. Both have a recommended default; confirm or override before implementing the affected units.

- **Open Decision A — key carrier: extend `UsageTelemetryData` vs. dedicated `SubagentUsageTelemetryUpdate` variant.** Extend = less code, reuse the pipeline, but mis-routing is a runtime risk. Distinct variant = mis-routing becomes a compile error, at the cost of a parallel path. *Recommended:* extend (lower blast radius) **only with** the three-site guard + invariant test in U1; otherwise prefer the variant. (Affects U1, U3.)
- **Open Decision B — "tokens consumed" semantics + idempotent accumulation.** Pick the meaning and the matching idempotent mechanism: (i) cumulative billed effort incl. cache reads (big numbers; needs per-step idempotent keying), (ii) **net new work = Σoutput + latest input snapshot** (output never re-counts; naturally idempotent — *recommended*), or (iii) Σoutput only. Drives the U4 label/tooltip and the U3 accumulation. (Affects U3, U4.)

---

## Implementation Units

### U1. Capture sub-agent usage in the Claude Code adapter (stop discarding it)

**Goal:** Emit per-sub-agent `UsageTelemetryUpdate`s from sub-agent assistant messages instead of dropping them.

**Requirements:** Success criteria 1, 4; GOD truth-upstream.

**Dependencies:** none.

**Files:**
- `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs` (modify `translate_assistant` lines ~204 & ~326; reuse/extend `build_usage_telemetry_from_json`)
- `packages/desktop/src-tauri/src/acp/session_update/types/interaction.rs` (add `parent_tool_use_id: Option<String>` to `UsageTelemetryData`)
- tests in `cc_sdk_bridge.rs`

**Approach:** When `parent_tool_use_id.is_some()`, build a `UsageTelemetryData` from the sub-agent assistant message's `usage`, set `parent_tool_use_id = Some(...)` and `source_model_id` from the message's `model`. **Note `build_usage_telemetry_from_json` today hardcodes `source_model_id: None` and `context_window_size: None` and takes no model arg** — U1 must add `model_id` (+ resolved window from U2) parameters to it (or fork a `build_subagent_usage_telemetry`) and update the existing top-level caller at ~line 326. Keep the per-call `total` (input+output+cache) on the step; the consumed/occupancy derivation is in the canonical reducer (U3). The existing `assistant_subagent_tool_use_does_not_emit_usage_telemetry` test is **replaced** with a characterization test of the new behavior. **Guard all three session-level sites** so a sub-agent message can never produce a session-level (`parent_tool_use_id = None`) record: the error-path emission at ~line 206, plus ~204/~326.

**Patterns to follow:** existing `build_usage_telemetry_from_json` and the session-level emission at line 326.

**Execution note:** Start by rewriting the locking test (`assistant_subagent_tool_use_does_not_emit_usage_telemetry`) to assert the new emit — red — then implement.

**Test scenarios:**
- Sub-agent assistant message with `parent_tool_use_id` + `usage` + `model` → emits one `UsageTelemetryUpdate` with `parent_tool_use_id = Some`, `source_model_id = model`, resolved `context_window_size`, token breakdown populated.
- Top-level assistant message (`parent_tool_use_id = None`) → still emits session-level telemetry with `parent_tool_use_id = None` (unchanged).
- **Invariant:** the error-path emission (~line 206) for a `parent_tool_use_id.is_some()` message does NOT build a session-level record.
- Sub-agent assistant message with no `usage` → emits nothing (no panic).
- Two sub-agents in one turn (distinct `parent_tool_use_id`) → two distinct updates.

### U2. Promote a production model→context-window resolver

**Goal:** Resolve a context-window size for a sub-agent from its model id when the provider sends none.

**Requirements:** Success criterion (context % correctness); Decision 3.

**Dependencies:** none (parallel to U1).

**Files:**
- `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs` (promote `context_window_for_model` out of `#[cfg(test)]`, correct the values) **or** a small dedicated module if a better home exists (e.g. alongside model catalog).
- tests for the resolver.

**Approach:** Author an **explicit, dated, per-model-id window table** (not a vague "promote") — there is no authoritative catalog for sub-agent windows, so the values are hand-maintained. Include any 1M-context variant with its gating caveat, and a documented default. Keep the table narrowly scoped to **window size only** — do not add other capability fields (that would breach the scope boundary; "alongside model catalog" is a location note, not license to build one). Wire it into U1's sub-agent build only when the provider sends no explicit `context_window_size`. Unknown id → `None` (U5 hides the chip; **no session-window fallback** — see Decision 3). Defer non-Claude providers.

**Patterns to follow:** existing `context_window_for_model` shape; `SessionContextBudgetSource` (TS-side tag, set in U3).

**Test scenarios:**
- Known model ids → expected window sizes (one per family, incl. any 1M-context variant).
- Unknown model id → `None` (caller hides the chip — NOT a session-window fallback).
- Resolver used only when provider value absent (provider-explicit wins).

### U3. Canonical per-sub-agent telemetry record + reducer branch

**Goal:** Build and store a `SessionSubagentTelemetry` map keyed by `parent_tool_use_id`, with consumed (cumulative) and occupancy (sticky) split.

**Requirements:** Success criteria 1, 3; Decisions 2, 4.

**Dependencies:** U1 (carries `parent_tool_use_id`).

**Files:**
- `packages/desktop/src/lib/acp/store/types.ts` (add `SessionSubagentTelemetry` interface + `subagentTelemetry?: ReadonlyMap<string, SessionSubagentTelemetry>` on `SessionTransientProjection`)
- `packages/desktop/src/lib/acp/store/envelope-reducer/canonical-subagent-telemetry.ts` (new — mirror `canonical-usage-telemetry.ts`)
- `packages/desktop/src/lib/acp/store/envelope-reducer/reduce-command.ts` (`reduceApplyTelemetry` branches on `telemetry.parentToolUseId`; prune on turn-terminal commands)
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts` + `session-transient-projection-store.svelte.ts` (setter/getter for the map; patch kinds `setSubagentTelemetry` and `clearSubagentTelemetry`)
- tests: `canonical-subagent-telemetry.vitest.ts`, additions to `reduce-command.vitest.ts`

**Approach:** New record fields: `sourceModelId`, `tokensConsumedTotal`, `latestOccupancyTokens` (sticky), `contextBudget` (resolved window + TS-set source tag), `lastTelemetryEventId`, `updatedAt`. `buildCanonicalSubagentTelemetry(prev, data)` applies the **same sticky-occupancy rule** as the session builder (occupancy = step `tokens.total` when present, else preserve — matches the real session basis, output included). **Consumed must be replay-idempotent** per Decision 4 (resolve Open Decision B): do not naively `+= step.total`, which both re-counts cache reads and breaks under re-apply. **Revision-gate caution (verified P1 risk):** `reduceApplyTelemetry` currently returns `[]` when `!isNewerGraphRevision(...)` *before* any session/sub-agent branch, and telemetry envelopes use `frontier_transition: None`; a session event and a sub-agent event in the same graph revision can starve each other. The sub-agent path must gate per-key (its own freshness), not on the single shared graph-revision check — add a test that interleaves a session event and a same-revision sub-agent event and asserts **both** apply. Reducer routes `parentToolUseId == null` to the existing session path, else to the new path producing a `setSubagentTelemetry` patch keyed by id; turn-terminal commands emit `clearSubagentTelemetry`.

**Patterns to follow:** [canonical-usage-telemetry.ts](packages/desktop/src/lib/acp/store/envelope-reducer/canonical-usage-telemetry.ts) (sticky occupancy + the `eventId` dedup guard), `reduceApplyTelemetry`, the transient-projection SvelteMap reactivity.

**Execution note:** Test-first — write the occupancy-sticky, consumed-idempotency (re-apply same step twice → no double-count), and same-revision-interleave cases before the builder.

**Test scenarios:**
- First sub-agent step → record created: occupancy = step total, model + window set, consumed per chosen definition.
- Second step (same key) → consumed advances correctly; occupancy replaced with new snapshot; window preserved.
- **Idempotency:** re-applying the same step (same id) twice does NOT double-count consumed.
- **Same-revision interleave:** a session telemetry event and a sub-agent telemetry event sharing a graph revision both apply (neither starves the other).
- Occupancy never exceeds resolved window.
- Two keys → two independent records.
- `parentToolUseId == null` event → routed to session telemetry, sub-agent map untouched.
- Window resolution: provider-explicit present → used; absent + known id → table value; unknown id → null (no session fallback).
- **Prune:** turn-complete / cancelled / failed → sub-agent map emptied (no stale keys leak into the next turn).

### U4. `@acepe/ui` presentational sub-agent row + metrics

**Goal:** A dumb row component: model + title left, two metric chips right.

**Requirements:** Success criteria 1; UI Package MVC.

**Dependencies:** none (pure view; can be built in parallel, integrated after U3).

**Files:**
- `packages/ui/src/components/agent-panel/subagent-activity-row.svelte` (new)
- `packages/ui/src/components/agent-panel/index.ts` (export)
- `packages/ui/src/components/agent-panel/subagent-activity-row-state.ts` (optional pure view helper for label/aria formatting)
- test: `packages/ui/src/components/agent-panel/subagent-activity-row-state.test.ts`
- `packages/website` mock usage (prove view renders standalone)

**Approach:** Props only: `{ model: string | null, title: string, status: "running" | "done" | "error", tokensConsumedLabel: string | null, contextPercent: number | null, contextLabel: string | null }`. The `status` field drives the running/done/error affordance (spinner/icon), **distinct from the two metric chips** — the "two metrics" framing stays accurate. UX requirements:
- **Loading/pending state:** before telemetry arrives, `tokensConsumedLabel = null` renders a placeholder (e.g. `—`) and `contextPercent = null` hides the context chip; the row shows title + spinner. Define this explicitly so units render it consistently.
- **Truncation:** the left label (model + title) truncates with ellipsis and reserves space for the two right chips (titles come from free-form `description`/`subagent_type`; model ids are long). Title gets a tooltip. Mirror `compact-tool-display.svelte` truncation.
- **Disambiguation from the session bar:** the per-row context chip carries a per-sub-agent label/aria (e.g. "sub-agent context 42%") so it isn't confused with the session-level context bar; tokens-consumed carries a label/tooltip clarifying it is *cumulative effort*, not context occupancy.
- **Accessibility:** aria-label on **both** chips and an accessible name for the row (model + title + status).

Reuse `agent-input-metrics-chip.svelte` for the context% ring — **verify it accepts a null/hidden state**; if it requires a non-null percent, wrap it conditionally rather than passing `null` in. Render tokens-consumed as a compact label chip. No store/Tauri imports (enforced by the UI boundary test).

**Patterns to follow:** [agent-input-metrics-chip.svelte](packages/ui/src/components/agent-panel/agent-input-metrics-chip.svelte), `compact-tool-display.svelte`, `pr-status-card.svelte` snippet shape.

**Test scenarios:**
- State helper formats tokens-consumed label (thousands → `12.3k`) and the disambiguating aria/label copy for both metrics.
- `tokensConsumedLabel == null` → placeholder `—`; `contextPercent == null` → context chip hidden, no crash.
- Boundary: percent clamped 0–100.
- Long title + long model id → left label truncates, chips stay visible.
- Test expectation for the `.svelte` view: covered by the UI package render smoke test (boundary); behavior asserted via the state helper.

### U5. Desktop controller: join active sub-agents to telemetry + map to row props

**Goal:** Model layer — produce the list of active sub-agent row props from canonical data.

**Requirements:** Success criteria 1, 2 (active-only); Decision 5.

**Dependencies:** U3, U4.

**Files:**
- `packages/desktop/src/lib/acp/components/agent-panel/logic/subagent-activity-rows.ts` (new pure mapper: `(taskToolCalls, subagentTelemetryMap, sessionModel) → SubagentRowProps[]`)
- `packages/desktop/src/lib/acp/components/agent-panel/components/subagent-activity-cards.svelte` (new controller wrapper: reads store, renders `@acepe/ui` rows)
- tests: `subagent-activity-rows.test.ts`

**Approach:** Select `Task` tool calls with `arguments.kind === "think"` and status `in_progress` (active-only). For each, join `subagentTelemetry[toolCall.id]`; derive title via `resolveTaskSubagent`, model from the telemetry record's `sourceModelId` (fallback to session model), `tokensConsumedLabel` and `contextPercent` from the record. Rows with no telemetry yet still render (title + spinner, metrics pending). Pure mapper is unit-tested; the `.svelte` wrapper only wires store reads.

**Patterns to follow:** existing model/controller split (`*-state.ts` + wrapper `.svelte`), `resolveTaskSubagent`, `getSessionToolCalls`, `getSessionActivity`.

**Test scenarios:**
- Two active Task calls + telemetry → two row props, correct model/title/metrics.
- Active Task call with no telemetry yet → row prop with pending metrics (no crash).
- Completed Task call → excluded (active-only).
- `contextPercent` derived from record occupancy/window; null when window unresolved.
- Stale telemetry entry whose Task is gone → not rendered.

### U6. Wire the cards into the pre-composer stack

**Goal:** Render the sub-agent cards in the stack, only when there are active sub-agents.

**Requirements:** Success criteria 1, 2.

**Dependencies:** U5.

**Files:**
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-pre-composer-stack.svelte` (add the card block + props)
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` (compute + pass props in the `preComposer` snippet)

**Approach:** Add a `{#if activeSubagentRows.length > 0}` block. **Default placement: directly above the composer, below the todo/queue cards** — sub-agent activity is the most transient/live signal, so it sits closest to the composer (rationale stated rather than deferred; adjust only with a reason). Pass the computed rows from the controller. Gate cheaply on `getSessionActivity(sessionId).activeSubagentCount > 0` before doing join work. **Overflow:** for a large Task fan-out, cap visible rows (e.g. first N) with a "+k more" affordance or make the region scroll, so the stack doesn't crowd out PR/todo/queue cards — pick one during work; do not leave growth unbounded silently.

**Patterns to follow:** existing card blocks in the stack (PR status, todos) and their prop pass-through from `agent-panel.svelte`.

**Test scenarios:** Test expectation: none for markup wiring beyond the controller/mapper tests; verified by DOM QA (see Verification). If a layout-ordering/overflow regression test is cheap at the stack level, assert the card appears when rows are non-empty and that the overflow affordance shows past the cap.

---

## System-Wide Impact

- **Rust adapter** (`cc_sdk_bridge.rs`): new emission path + a replaced test; session-level path unchanged.
- **Canonical store**: new transient-projection field + patch kind + reducer branch; session telemetry untouched.
- **Generated types** (`acp-types.ts`): regenerate after the Rust `UsageTelemetryData` field add (specta).
- **UI package**: one new presentational component + export; boundary test must still pass.
- **Agent panel**: one new card; existing cards unaffected.

---

## Risks & Mitigations

- **Context-window size wrong/stale for sub-agents** → could show misleading %. The window table (U2) is hand-maintained with no provider source of truth for sub-agents, so it *will* drift as models change; mitigate with a dated maintenance note and by **hiding** the chip on any unresolved id rather than guessing or borrowing the session window (Decision 3).
- **Telemetry/tool-status race + revision-gate interleaving (active-only)** → mitigated by joining on live tool status, a defined prune patch on turn-terminal, per-key freshness gating in the reducer (not the shared graph-revision gate), and idempotent consumed accumulation (Decisions 4, 5; U3). Rows tolerate missing/late telemetry; U5 defines whether the post-completion final metric is shown.
- **Specta regen drift** → run the generator and `bun run check` after U1; the `parent_tool_use_id` field is additive/optional.
- **Map reactivity** → follow the existing SvelteMap fine-grained pattern in the transient projection store; avoid `$effect`.

---

## Verification Strategy

- Rust: `cargo test` for U1/U2 (new emission + resolver).
- TS: `bun test` for the canonical sub-agent builder, reducer branch, mapper, and UI state helper; `bun run check`.
- UI boundary: `packages/ui` boundary + render smoke test stays green.
- Live DOM QA (mandatory, per `acepe-dev-app-qa`): run a session that spawns sub-agents (e.g. a Task fan-out), then `bun run qa doctor → observe → inspect --selector=<subagent row selector> → screenshot`; confirm one row per active sub-agent with model + both metrics, context % ≤ 100, and rows clearing when the turn ends.

---

## Deferred Implementation Notes

- Exact selector/class names for the new row (decide during U4/U6).
- Exact overflow affordance for large fan-outs (cap + "+k more" vs. scroll) — U6 picks one.
- Whether the pure mapper lives under `logic/` or co-located with the wrapper (during U5).
- Non-Claude provider producers (future).
