---
title: "refactor: Clean session ingress architecture (one funnel, one fold)"
type: refactor
status: active
date: 2026-07-12
supersedes_partial:
  - docs/plans/2026-05-17-001-refactor-single-session-materialization-engine-plan.md
builds_on:
  - docs/plans/2026-05-18-001-refactor-full-god-session-transcript-authority-plan.md (completed)
  - docs/plans/2026-04-15-001-refactor-projection-first-session-startup-plan.md
---

# Clean Session Ingress Architecture

## 0. Thesis (the one idea)

There is exactly **one canonical fact vocabulary** (`ProviderEvent`) and exactly **one deterministic fold** (`session::engine::fold`) that turns an ordered `ProviderEvent` stream into the `SessionGraph`. **Live and history differ only in where the event stream comes from, never in how truth is built.**

History is not "conversion." History is *recorded provider events replayed through the same fold that live events use*. Once this holds, the entire `session_converter/` layer, `FullSession`/`StoredEntry` as truth, `CanonicalTranscriptEvent`, the second (live) transcript reducer, and virtually all of `session_materialization`'s relink/ensure/drop repair collapse into nothing, because two paths that share one fold cannot disagree.

---

## 1. Layer diagram — one job per layer

```text
                     ┌─────────────────────────────────────────┐
  raw provider bytes │  TRANSPORT           spawn / connect / IO │  (process + socket only)
  & process mgmt  →  └─────────────────────────────────────────┘
                                     │ raw JSON / raw disk rows
                                     ▼
                     ┌─────────────────────────────────────────┐
  provider quirks    │  INGRESS (Source)    raw → ProviderEvent  │  (the ONLY normalization edge)
  live OR history →  │   • LiveSource: ACP JSON  → ProviderEvent │
                     │   • HistorySource: disk   → ProviderEvent │
                     └─────────────────────────────────────────┘
                                     │ Vec<ProviderEvent>  (provider-agnostic, ordered, typed)
                                     ▼
                     ┌─────────────────────────────────────────┐
  the single truth   │  ENGINE (fold)       events → SessionGraph│  (deterministic reducer)
  builder         →  │   • fold_full   (history / open)          │
                     │   • fold_step   (live delta)              │
                     │   • invariants  (assert / typed-degrade)  │
                     └─────────────────────────────────────────┘
                                     │ SessionGraph (canonical, revisioned)
                                     ▼
                     ┌─────────────────────────────────────────┐
  delivery only   →  │  DELIVERY            graph → wire payloads │  (carve, never repair)
                     │   • SessionOpenResult / snapshot / delta  │
                     │   • viewport / scene projections          │
                     └─────────────────────────────────────────┘
                                     │
                                     ▼
                          TypeScript / @acepe/ui  (render only)
```

Rules per layer (strict SOC):

| Layer | Owns | Forbidden |
|---|---|---|
| **Transport** | Spawning the agent, ACP socket lifecycle, byte IO | Any semantic interpretation, any tool/transcript shaping |
| **Ingress** | Turning provider-specific raw input (live **or** disk) into the shared `ProviderEvent` vocabulary; ALL provider quirks | Building the graph; deriving display ids; merging operations |
| **Engine** | The one fold: identity, ordering, linking, operation merge, interaction/lifecycle state, revision, invariants/degradation | Reading raw provider formats; delivery framing; provider branches |
| **Delivery** | Carving `SessionGraph` into open-result / snapshot / delta / viewport | Any truth mutation, any repair, any provider awareness |

Provider-specific code exists in **exactly two places**: Transport and Ingress. Engine and Delivery are 100% provider-agnostic.

---

## 2. Module tree (target)

```text
acp/session/
  transport/                    # was acp/providers/* (connect/spawn half)
    mod.rs                      # trait Transport { spawn, connect, capabilities }
    claude_code.rs cursor.rs codex.rs copilot.rs opencode.rs custom.rs

  ingress/                      # THE normalization edge → ProviderEvent
    event.rs                    # ProviderEvent + ProviderEventKind  (the ONE vocabulary)
    source.rs                   # trait LiveSource, trait HistorySource
    tool_identity/              # was acp/reconciler/  (kept; renamed for glossary)
      mod.rs                    # classify_raw_tool_call, kind/name/args authority
      table_<provider>.rs       # provider tool-name → kind tables (was reconciler/providers/*)
    providers/
      claude_code.rs            # LiveSource + HistorySource + tool table wiring for Claude
      cursor.rs                 # (merges cursor sqlite + streaming-log disk sources here)
      codex.rs copilot.rs opencode.rs custom.rs
    plugin.rs                   # ProviderPlugin registry (one registration per provider)

  engine/                       # THE single fold (was runtime.rs + transcript_events.rs
                                #  + session_materialization repair, unified)
    fold.rs                     # fold_full / fold_step spine
    fold_transcript.rs          # transcript fact reducer (cohesion split)
    fold_operations.rs          # operation merge (one merge_tool_call_update lives here)
    fold_interactions.rs        # question/permission/plan
    fold_lifecycle.rs           # turn state, usage, capabilities, activity
    graph.rs                    # SessionGraph canonical type
    identity.rs                 # deterministic display_id + operation_id derivation
    frontier.rs                 # event_seq / revision derivation
    invariants.rs               # assert-linked / typed-degrade

  delivery/                     # was session_open_snapshot/ + snapshot/delta carving
    open_result.rs              # SessionOpenResult (found|missing|error, attach token)
    snapshot.rs delta.rs        # wire envelopes carved from SessionGraph
    viewport/                   # was acp/transcript_viewport/ (ledger, projection, row)
    scene.rs                    # graph → agent-panel scene rows (Rust-owned)

  runtime/                      # per-session hot holder + delivery plumbing
    registry.rs                 # was session_state_engine registry: holds SessionGraph/session
    envelope_router.rs event_hub.rs   # attach-token reservation, ordered delta buffer
```

**Deleted top-level modules** (folded into `ingress/providers/*` as HistorySource): `session_converter/`, `cursor_history/`, `session_jsonl/`, `copilot_history/`, `opencode_history/`, `history/cursor_sqlite_parser.rs`.

> Note: the *raw parsing code* (sqlite reads, jsonl scanning) is not thrown away — it moves under the owning provider's `HistorySource` and its output type changes from `FullSession`/`StoredEntry` to `Vec<ProviderEvent>`.

---

## 3. Single ingress funnel

### 3.1 The one vocabulary — `ProviderEvent`

`ProviderEvent` is the widened, provider-agnostic superset of today's `SessionUpdate` plus the ordering/turn facts that only history currently carries implicitly. It replaces **all three** of: `SessionUpdate`-as-input, `CanonicalTranscriptEvent`, and `StoredEntry`-as-input.

```rust
pub struct ProviderEvent {
    pub source: CanonicalAgentId,      // metadata, never UI identity
    pub provider_seq: u64,             // provider-native order key
    pub provider_row_id: String,       // provider identity (metadata; engine owns display id)
    pub timestamp_ms: Option<i64>,
    pub kind: ProviderEventKind,
}

pub enum ProviderEventKind {
    UserText { text: String },
    UserPastedContent { text: String },
    AssistantText { text: String },
    AssistantThought { text: String, redacted: Option<String> },
    AssistantError { text: String, error: AssistantMessageError },
    ToolCall(ToolCallData),                 // create
    ToolCallUpdate(ToolCallUpdateData),     // status/args/result — history emits these too
    Permission(...) Question(...) Plan(...),
    Usage(UsageTelemetryData),
    ModeUpdate(...) CapabilitiesUpdate(...),
    TurnBegin { request_id: Option<String> },
    TurnEnd   { outcome: TurnOutcome },     // makes history turn boundaries explicit
}
```

Closed enum, no `Other`, no provider branches. If a provider needs a new fact, add a variant here — that is the *only* place a fact can enter the system.

### 3.2 The two sources, one output

```rust
pub trait LiveSource {                      // was AgentParser
    fn normalize(&self, raw: &serde_json::Value) -> Result<Vec<ProviderEvent>, ParseError>;
}
pub trait HistorySource {                   // was disk parser + session_converter
    fn read(&self, input: HistoryInput) -> Result<Vec<ProviderEvent>, HistoryError>;
}
```

- **Live:** `Transport` → raw ACP JSON → `LiveSource::normalize` → `Vec<ProviderEvent>` → `engine::fold_step`.
- **History:** disk bytes → `HistorySource::read` → `Vec<ProviderEvent>` → `engine::fold_full`.

Cursor's two disk sources (sqlite `store.db` + streaming logs) are merged **inside** `ingress/providers/cursor.rs::read` into one ordered `ProviderEvent` stream. This is exactly the GOD-sanctioned home for provider quirks — at the edge, before truth. There is **no post-fold overlay** (kills pain #3's `cursor.rs` streaming overlay).

### 3.3 The one fold

```rust
pub fn fold_full(events: &[ProviderEvent], ctx: &FoldContext) -> SessionGraph;
pub fn fold_step(prev: &SessionGraph, event: &ProviderEvent) -> (SessionGraph, GraphDelta);
```

Same identity derivation, same operation merge, same linking rules for both. Because a tool row and its operation are created by the *same fold pass keyed on the same `ProviderEvent` identity*, they are linked at birth — the relink/ensure/drop repair becomes structurally impossible to need.

---

## 4. What gets deleted (explicit)

| Deleted | Why | Replacement |
|---|---|---|
| `session_converter/` (mod, claude, cursor, opencode, fullsession, transcript_events) | It is the redundant 4th layer / second reducer | `ingress/providers/*::HistorySource` emitting `ProviderEvent` |
| `FullSession` (as truth spine) | Display-shaped provider DTO masquerading as an intermediate model | Provider raw types are a private detail of each `HistorySource`; output is `ProviderEvent` |
| `StoredEntry` (as canonical/display **input**) | Display rows fed back as truth — the original bug class | Deleted from ingress. If export needs it, a one-way `graph → StoredEntryExport` projection in `delivery/` |
| `TranscriptSnapshot::from_stored_entries` | Legacy dual builder | Only the fold builds transcript; no `from_*` variants |
| `CanonicalTranscriptEvent` + `transcript_events.rs::materialize_*` | History-only second event type | `ProviderEvent` (superset) emitted by `HistorySource` |
| `transcript_projection/runtime.rs` **live fold** | Second reducer with its own display-id logic | `engine::fold_step` |
| `session_materialization` repair: `relink_operations_to_transcript`, `ensure_transcript_tool_operations`, `drop_unlinked_duplicate_replay_tool_rows`, `close_historical_active_projection` | Repair that exists only because two paths disagree | `engine::invariants` (assert-linked / typed-degrade); one fold makes them dead |
| `session_converter/mod.rs::merge_tool_call_update` | Operation merge in the wrong (converter) layer | `engine/fold_operations.rs` (single merge authority) |
| Top-level `cursor_history/ session_jsonl/ copilot_history/ opencode_history/ history/cursor_sqlite_parser.rs` | Ingress sprawl | Moved under `ingress/providers/<name>` as HistorySource internals |

`FullSession`/`StoredEntry` survive **only** as (a) private parse scratch inside a `HistorySource` and (b) an export DTO generated *from* `SessionGraph`, never *into* it.

---

## 5. Provider extension model (one touch point)

A new provider is one `ProviderPlugin` registered once:

```rust
pub struct ProviderPlugin {
    pub id: CanonicalAgentId,
    pub transport: &'static dyn Transport,
    pub live: &'static dyn LiveSource,
    pub history: &'static dyn HistorySource,
    pub tool_table: &'static ToolTable,
}
// ingress/plugin.rs
static PLUGINS: &[ProviderPlugin] = &[CLAUDE_CODE, CURSOR, CODEX, COPILOT, OPENCODE, CUSTOM];
```

Physical footprint per provider: **`transport/<name>.rs` + `ingress/providers/<name>.rs` + a tool table**, wired in `ingress/plugin.rs`. That collapses Cursor's current 4 scattered homes (`cursor_history`, `session_converter/cursor.rs`, `parsers/cursor_parser.rs`, `reconciler/providers/cursor.rs`) into **one provider folder + one transport file + one registration line**. Engine and Delivery never learn a provider exists.

Conformance is enforced by one `provider_plugin_conformance` test suite that runs the same fixture battery against every registered plugin (live-normalize parity, history-read parity, and the live≡history graph-equality invariant below).

---

## 6. Naming glossary (kills adapter/parser/converter/materialization)

| Kill | Use | Meaning |
|---|---|---|
| `AgentProvider` | **Transport** | Spawns/connects the agent process + socket. Nothing semantic. |
| `AgentParser` | **LiveSource** | Live raw ACP JSON → `ProviderEvent`. |
| disk parser + `session_converter` | **HistorySource** | Disk bytes → `ProviderEvent`. |
| `*Adapter` (reconciler tables) | **ToolTable** (under `ingress::tool_identity`) | Provider tool-name → `ToolKind`. |
| "adapter edge" (colloquial) | **Ingress** | The whole normalization layer. |
| `converter` / `materialization` | **Engine / fold** | The single truth builder. |
| `SessionUpdate` / `CanonicalTranscriptEvent` / `StoredEntry`(input) | **ProviderEvent** | The one canonical fact vocabulary. |
| `SessionThreadSnapshot` / `ProviderOwnedSessionSnapshot` | **(deleted)** | No provider-owned snapshot type; events go straight to the fold. |
| projection (as truth) | **SessionGraph** (truth) / **Projection** (read-only view) | Truth vs delivery view are named distinctly. |

The word **adapter** is banned from the session domain. `reconciler` is renamed `tool_identity` so "reconcile" no longer competes with "fold."

---

## 7. File-size budget

| Module type | Target | Hard cap | Split rule |
|---|---|---|---|
| `ProviderEvent` / `graph.rs` types | ≤300 | 400 | Split by fact family, not by provider |
| `engine/fold*.rs` (per fact family) | ≤350 | 500 | One fact family per file, composed by `fold.rs` spine |
| `engine/fold.rs` spine | ≤200 | 300 | Names + orders the family folds only |
| `identity/frontier/invariants` | ≤200 | 300 | — |
| `ingress/providers/<name>.rs` | ≤400 | 600* | *Cursor may hit 600 due to dual-source merge; document the reason inline |
| `transport/<name>.rs` | ≤300 | 400 | — |
| `delivery/*` | ≤300 | 400 | — |

Global rule: **nothing over 800 lines, ever.** Anything over 500 requires a one-line cohesion justification at the top of the file. Current offenders (`session_converter/mod.rs` 1284, `cursor_sqlite_parser.rs` 1824, `cursor_history/parser.rs` 1204, `transcript_events.rs` 760, `fullsession.rs` 688) are all deleted or decomposed by this plan.

---

## 8. Migration phases (sequential; no coexistence *within* a phase)

Each phase ends with the old path physically removed. TDD: characterization fixtures captured in Phase 0 gate every later phase.

**Phase 0 — Freeze current truth as fixtures.**
Capture golden `SessionGraph` snapshots for a representative session per provider, from *both* live replay and history open, using the known bad sessions (`b859c458…`, `f2197319…`, `4c6efddf…`, plus the cursor junk fixture). These become the equality oracle. No production change.

**Phase 1 — Engine + `ProviderEvent`, cut LIVE onto it.**
Introduce `ProviderEvent`, `SessionGraph`, and `engine::fold` (full+step). Make `LiveSource` emit `ProviderEvent` and route the live path through `fold_step`. Delete `transcript_projection/runtime.rs`'s live transcript fold. Live graph must equal the Phase 0 live golden.

**Phase 2 — Cut HISTORY onto the same fold; delete the converter spine.**
Implement `HistorySource` per provider emitting `ProviderEvent`; route open/resume/state through `fold_full`. Delete `session_converter/` (all files), `CanonicalTranscriptEvent`, `from_stored_entries`, and the `session_materialization` repair functions. Prove the **core invariant**: `fold_full(history_events) == replay of fold_step over the same events` and both equal the Phase 0 goldens. This is where the biggest LOC deletion lands.

**Phase 3 — Consolidate provider modules + naming.**
Move `cursor_history/ session_jsonl/ copilot_history/ opencode_history/ cursor_sqlite_parser.rs` under `ingress/providers/*`. Rename `AgentProvider→Transport`, `AgentParser→LiveSource`, `reconciler→tool_identity`, `*Adapter→ToolTable`. Add `ProviderPlugin` registry + conformance suite + an import guard test forbidding provider names in `engine/` and `delivery/`.

**Phase 4 — Delivery cleanup.**
Carve `SessionOpenResult`/snapshot/delta/viewport/scene directly from `SessionGraph`; delete the residual `session_materialization` wrapper and `session_thread_snapshot` types. Delete `StoredEntry` except a one-way export projection in `delivery/`.

Dependency order: `0 → 1 → 2 → 3 → 4`. Phases 1 and 2 could reorder (history-first) if deterministic fixture validation is preferred earlier; history-first also deletes more code sooner. Recommended: keep live-first only if live regressions are the higher product risk; otherwise **history-first**.

---

## 9. Thermo-nuclear self-review (honest risks)

**Where this could still fail the bar:**

1. **`ProviderEvent` becoming a god-enum.** Mitigation: it is a *closed fact vocabulary* with no provider arms and no `Other`; growth requires a new fact, which is a real domain event, not a provider quirk. If a variant is ever gated on `source ==` something, the design has failed — enforce with a lint/grep guard in `engine/`.

2. **Live ≡ history graph equality is the load-bearing invariant and the hardest to hold.** Hot-state (capabilities, current model, live turn activity) exists live but not in history. Resolution (consistent with the 2026-04-15 plan): `SessionGraph` *persisted truth* (transcript, operations, interactions, terminal turn state) must be equal; *live-only lifecycle* (capabilities/model/active-turn) is a separate, explicitly non-persisted region of the graph that history leaves empty. The equality test asserts on the persisted region only. If this split is fuzzy, the invariant rots — it must be a typed boundary, not a convention.

3. **Cursor dual-source ordering.** Merging sqlite + streaming logs into one ordered `ProviderEvent` stream is non-trivial (timestamp collisions, partial streaming rows). Risk of reintroducing an overlay disguised as a merge. Guard: the merge must be a pure `(Vec<A>, Vec<B>) -> Vec<ProviderEvent>` with explicit tie-breakers, unit-tested in isolation, and it must run *before* the fold, never touching `SessionGraph`.

4. **`fold_step` idempotency / determinism.** Live delivers duplicates and out-of-order events; `fold_step` must be idempotent on `provider_row_id`+kind and derive ids/revision from content, not wall clock or insertion order (carry over the determinism contract from the 2026-05-17 plan). Any nondeterminism breaks the equality oracle.

5. **Deletion blast radius.** `StoredEntry`/`FullSession` have many callers (db, export_types, e2e fixtures, session_jsonl parser tests). Phase 4 must inventory every consumer; the export DTO is the only survivor and it is generated *from* the graph. Risk: a hidden consumer keeps `StoredEntry` on a truth path. Guard: grep-gate that `StoredEntry` appears only under `delivery/export` and tests.

6. **One fold file balloons past budget.** Mitigation: the fold is split by fact family (`fold_transcript/operations/interactions/lifecycle`) composed by a thin `fold.rs` spine — a cohesion split with a named spine, not layering. If the spine starts holding logic, that is the smell to stop.

7. **Performance regression on long history.** Folding a full event stream may cost more than the old direct build. Mitigation: fold is linear; carry the 2026-05-17 timing counters (rows read/accepted/filtered, duration, revision) and validate against long-session fixtures before deleting the old path.

**What passes cleanly:** SOC is strict (provider code confined to Transport+Ingress); the biggest sprawl (`session_converter`, dual reducers, dual snapshot builders, materialization repair, `FullSession`/`StoredEntry` truth) is *deleted*, not rearranged; naming collisions (adapter×3) are resolved; the extension model is one plugin; and the central correctness property (one fold ⇒ live and history cannot disagree) is a testable invariant, not a hope.

**Recommended first action:** land Phase 0 fixtures + the `ProviderEvent`/`SessionGraph` type skeleton and the live≡history equality test as a *failing* oracle, so every subsequent deletion is gated by a green graph-equality proof.
