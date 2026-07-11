---
title: "refactor: Canonical first-display session startup"
type: refactor
status: reviewed
date: 2026-07-11
---

# Refactor: Canonical first-display session startup

## Goal

Make Acepe display persisted projects, session titles, and the visible transcript tail as soon as the app shell can render. First display must read only bounded, Rust-owned canonical stores. Provider discovery, title repair, usage enrichment, transcript parsing, ledger rebuilding, and reconnect remain important, but none may delay already-canonical content. For cold sessions, success includes reducing time until real transcript rows appear; an immediate `preparing` state is necessary feedback, not the end performance outcome.

This is a clean replacement of the current delayed startup pipeline. It is not a timer-only optimization and does not introduce a second metadata or transcript authority.

## Current State

### Startup scheduling

The shell becomes ready after keybinding initialization, then workspace restoration begins on the next task. Project loading begins immediately after workspace restoration, but session-history scanning is scheduled behind a five-second idle delay. Restored panel metadata is also scheduled behind that delay; only after metadata validation completes is restored transcript preload scheduled behind a second thirty-second idle delay.

```text
shell ready
  -> restore workspace
      -> load projects immediately
          -> wait 5s/idle -> scan project sessions
      -> wait 5s/idle -> load restored session metadata
          -> wait 30s/idle -> open restored transcript
```

The result is an intentional roughly thirty-five-second floor before a restored transcript request starts.

### Session list metadata

`scan_project_sessions_inner` has a SQLite index fast path, but it does not return indexed session titles immediately. It synchronously enriches every indexed Claude session with usage statistics by reopening provider JSONL files sequentially. It may then scan missing projects from every provider and always supplements indexed results with a Copilot scan before returning.

`get_startup_sessions` has the same coupling for restored sessions: it queries indexed metadata, then reopens each Claude JSONL serially for usage statistics before returning the metadata needed to open panels.

### Transcript open

`get_session_open_result_domain` correctly prefers the transcript row ledger and returns a bounded initial suffix (maximum sixteen rows, minimum eight where available, approximately 24 KiB). On a current ledger this is the desired first-display path.

On a ledger miss, the command synchronously loads provider history, converts the full provider snapshot into canonical state, restores runtime authority, persists a complete row ledger, compacts the open result, and only then returns. This makes provider parsing and canonical repair part of the foreground open request.

The frontend also clears existing provider-backed transcript entries before the replacement snapshot arrives, turning backend latency into an avoidable blank state.

### Existing strengths to preserve

- Rust owns canonical session metadata, transcript order, transcript identity, operations, interactions, lifecycle, and the transcript row ledger.
- The row-ledger open path is byte bounded and already returns an initial transcript suffix.
- Session open has explicit `found`, `missing`, and `error` outcomes plus timing fields.
- Workspace restoration persists panel hints that can seed a cold shell while canonical data is loaded.
- Background row-ledger warming exists and is bounded.

## GOD Architecture Classification

| Data or behavior | Classification | Owner after refactor |
|---|---|---|
| Project identity, path, display metadata | canonical-owned persisted metadata | Rust storage repositories |
| Session id, project, agent, title, timestamp, source identity | canonical-owned persisted metadata | `session_metadata` repository |
| Provider file mtime/size and raw provider ids | provider metadata | Rust indexers/adapters only |
| Usage totals derived from provider history | canonical enrichment, non-critical | Rust background index/enrichment path |
| Transcript order, entry identity, operation links | canonical-owned | Rust transcript/operation projections |
| Initial visible transcript suffix | canonical-owned read model | transcript row ledger |
| Provider-history parse and ledger rebuild | canonical repair work | Rust adapters/materializer, never UI |
| Loading animation and request guard | truly local | TypeScript |
| Five/thirty-second first-display delays | must be deleted | N/A |
| UI-side transcript preservation as a second authority | forbidden | Do not introduce |

No provider-specific branch will be added to TypeScript. No UI repair or fallback from canonical data to raw provider history will be added. A missing canonical artifact is handled as an explicit readiness state and triggers upstream repair.

## Target State

```text
app shell ready
  |
  +-> immediate bounded canonical reads in parallel
  |     first 50 persisted projects + restored project ids
  |     recent indexed session summaries (100/project, 500 total)
  |     selected exact session, then restored ids in chunks of 32
  |     -> render project/session titles immediately
  |
  +-> selected/restored panels request canonical transcript suffix immediately
  |     current ledger -> render suffix
  |     unavailable ledger -> explicit preparing state + background canonical repair
  |                           -> ticket await returns canonical found suffix
  |
  +-> background work
        provider discovery/reconciliation
        usage enrichment
        stale/missing ledger rebuild
        reconnect/live transport
```

### First-display contracts

First display uses separate, parallel canonical reads rather than a new combined bootstrap abstraction:

- a paged persisted-project read returns the first 50 projects ordered with restored/selected projects first, then recent projects; later pages load without blocking first display;
- an indexed-session-summary read returns the newest 100 closed sessions per project, matching the existing sidebar cap, with a 500-session aggregate page bound;
- the exact restored-session metadata read resolves the selected session first, then remaining restored panel identities and canonical id remaps in chunks of at most 32;
- none includes usage-stat enrichment that requires provider-file reads;
- none includes transcript bodies.

Each command returns useful results independently. A missing restored session row does not prevent projects or other session summaries from rendering. The frontend subscribes to metadata-index change notifications before starting background discovery, then rereads only affected bounded project pages or exact session ids.

The 100-session bound is grounded in the existing `limitItemsPerProject(..., 100)` sidebar policy. It is also necessary in practice: on 2026-07-11 the local development database contained 833 session rows, with 484 in the largest project, 47 registry placeholders, and 100 fallback titles. SQLite ownership alone does not make an all-rows IPC payload bounded.

The aggregate project/session/chunk limits bound the first response even for unusually large workspaces. Later pages are progressive canonical reads, not provider scans. Search for older projects/sessions queries SQLite directly instead of requiring all metadata to be resident in the frontend.

### Transcript readiness contract

Transcript open has two canonical outcomes in addition to existing missing/error semantics:

- `ready`: a current canonical row ledger supplied the bounded initial suffix;
- `preparing`: canonical transcript content is not yet current, and Rust has started or joined one deduplicated repair job.

`preparing` is not a provider-data fallback. It returns a Rust-owned repair ticket. The frontend immediately calls a replayable `await transcript repair` command with that ticket. The coordinator uses watch-style stored completion state, so the await returns correctly even if repair finished before the second command began. On success it returns the normal full `found` result with a fresh open token and bounded suffix; only then does the frontend hydrate and reconnect. This avoids a lost edge-triggered completion event and keeps existing open-token/frontier semantics.

The UI may retain already-rendered canonical rows only as ephemeral same-session presentation state guarded by canonical session id, canonical revision, and request token. TypeScript does not parse, repair, reorder, persist, or override those rows. A newer Rust snapshot always replaces them authoritatively.

Manual open and restored open use the same readiness contract. Opening a different session never leaves rows from the previous session visible.

### Freshness model

- Indexed metadata is immediately displayable even if provider discovery has not run during this process.
- Provider indexers atomically update canonical session metadata when files change and emit a typed `history-index-changed` notification containing affected project paths/session ids plus an index revision. The frontend listener is installed before discovery begins and rereads bounded canonical summaries; the event does not carry provider data.
- Usage statistics are stored/enriched asynchronously and update the sidebar later without blocking titles.
- A transcript ledger is usable only when its existing revision/fingerprint checks prove it current.
- Stale ledgers never masquerade as current content. They yield `preparing`, then repair upstream.
- Reconnect still occurs after snapshot hydration and may deliver only post-frontier live events.
- Canonical index usefulness is measured, not assumed. Before changing behavior, an audit compares recent provider discovery candidates to `session_metadata`, reports per-provider coverage, exact restored-id hit rate, registry-placeholder rate, and fallback-title rate. After a completed index scan, every discoverable recent candidate in the bounded project pages must have one canonical row; every restored id must resolve or produce an explicit typed unavailable result.

## Requirements

### R1 — Immediate metadata

After workspace restoration, persisted projects and indexed session titles must begin loading in parallel without a fixed delay or `requestIdleCallback` dependency. Workspace restoration itself is part of the measured critical path because it supplies visible panel identities.

### R2 — Bounded critical path

The metadata first-display commands must perform bounded SQLite reads only: at most 50 projects in the first page, 100 closed sessions per project and 500 session summaries in the aggregate page, and exact restored ids in chunks of 32 with the selected id first. They must not read provider transcript files, invoke provider CLIs/services, calculate usage statistics from history, or wait for global discovery.

### R3 — Immediate restored transcript request

The selected restored panel must request its canonical transcript suffix first, as soon as its persisted identity is available. Other visible restored panels follow through the bounded priority queue. No five-second or thirty-second scheduler may gate request submission.

### R4 — Canonical transcript only

The UI may render transcript content only from the canonical transcript row ledger/session-open projection. Provider history remains Rust adapter input and never becomes a frontend fallback.

### R5 — Non-blocking cold repair

A missing or stale ledger must start or join one deduplicated background repair and return a `preparing` result promptly. Full provider parse, materialization, and ledger persistence must not block the first open response. The repair coordinator globally bounds provider repair work and uses weighted fair scheduling across selected/manual, other visible, and backfill classes. Higher classes receive more slots without allowing a continuously busy class to starve lower work. Acceptance covers both time to `preparing` and time until actual canonical rows render.

### R6 — Honest visible state

When no canonical rows exist, the panel shows the existing loading surface with an accessible busy state and polite status announcement. When canonical rows for the same session are already displayed, they remain visible with a subtle existing-status-area refreshing indication until a newer canonical snapshot is ready; they are ephemeral presentation state, not a second authority. Repair failure transitions to the existing explicit load-failure surface with retry and close/dismiss actions. Retry starts a new repair ticket and returns through `preparing`; it never exposes partial provider content. Rows from another session must never be retained.

### R7 — Progressive enrichment

Provider discovery, placeholder/title reconciliation, Copilot supplementation, and usage enrichment update canonical metadata after first display through typed index-change notifications and bounded rereads. Title corrections update items in place without reordering unrelated visible items; active/open sessions are never removed by a background stale snapshot. Failures in one provider must not suppress indexed results from other providers.

### R8 — One architecture

Startup restore and manual session open must use the same exact-session metadata read and transcript readiness/repair contracts. Project-list pagination remains startup/sidebar-specific. Remove the old delayed-preload and foreground legacy-rebuild paths rather than keeping both.

### R9 — Measured performance contract

Instrumentation and tests must prove:

- no fixed scheduling delay before metadata or restored transcript requests;
- first-display metadata reads perform no provider-file enrichment;
- hot-ledger initial payload remains bounded by the existing row/byte policy;
- cold open returns `preparing` before repair completes, then the replayable ticket await returns the canonical `found` snapshot;
- only one repair runs per canonical session;
- repair completion cannot be missed even when it happens before the frontend begins awaiting;
- selected-panel work runs before queued visible/backfill work;
- completion renders canonical content and reconnects without historical replay.

### R10 — User-visible verification

Desktop QA must observe a restored workspace and prove project title, session title, and transcript/preparing/ready or failure state ordering in the running Tauri app. The final QA evidence must include timestamps from startup diagnostics, DOM inspection of the relevant project/session/panel elements, and accessibility facts (`aria-busy`/status announcement) for dynamic readiness.

## Non-Goals

- No visual redesign of the project sidebar or agent panel.
- No browser-only startup proof; Tauri QA is required.
- No provider-specific TypeScript handling.
- No weakening of ledger freshness checks.
- No read-only historical sessions; reconnect remains required after snapshot hydration.
- No startup-wide eager parsing of every transcript.
- No migration/coexistence layer. The old delayed and foreground-blocking paths are removed in the same change.

## Affected Files

| File or area | Change | Dependencies |
|---|---|---|
| `packages/desktop/src-tauri/src/history/commands/scanning.rs` | Split canonical indexed reads from background enrichment/discovery; delete usage enrichment from list/startup critical paths | Session metadata repository |
| `packages/desktop/src-tauri/src/history/commands/` focused indexed-summary module if scanning cannot remain a readable spine | Add bounded per-project and exact-id canonical summary reads | Project/session repositories |
| `packages/desktop/src-tauri/src/db/repository/session_metadata.rs` | Add paged project/session summary queries and exact-id chunk reads | Existing schema/indexes |
| `packages/desktop/src-tauri/src/db/entities/`, `src-tauri/src/db/migrations/`, repository | Add one-to-one versioned `session_history_enrichment` storage for usage totals and source fingerprint | Session metadata foreign key |
| `packages/desktop/src-tauri/src/acp/session_open_snapshot/types.rs` | Represent transcript readiness/preparing outcome without leaking provider details | Generated TS contract |
| `packages/desktop/src-tauri/src/acp/session_restore/open_session.rs` | Keep hot-ledger foreground path; replace synchronous legacy rebuild with repair coordinator handoff | Provider load/materialization and ledger builder |
| `packages/desktop/src-tauri/src/acp/session_restore/` new repair coordinator module | Weighted fair queue, global concurrency bound, per-session deduplication, replayable ticket completion, canonical ledger persistence | Runtime registry, projection registry |
| `packages/desktop/src-tauri/src/history/commands/ledger_backfill.rs` | Reuse one repair primitive; remove duplicate rebuild ownership | Repair coordinator |
| `packages/desktop/src-tauri/src/commands/registry.rs`, `src-tauri/src/lib.rs`, generated bindings | Register changed/new command contracts | Specta generation |
| `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts` | Replace delayed metadata/preload chain with immediate parallel first-display reads and selected-panel-first open | Session/project stores |
| `packages/desktop/src/lib/acp/store/services/session-repository.ts` | Consume bounded per-project and exact-session summaries; stop coupling startup metadata to history scan enrichment | Tauri history client |
| `packages/desktop/src/lib/components/main-app-view/logic/open-persisted-session.ts` | Handle `preparing`; preserve only same-session canonical rows; remove foreground rebuild expectation | Session-open hydrator |
| `packages/desktop/src/lib/acp/store/services/session-open-hydrator.ts` | Apply completed canonical snapshot monotonically | Existing open token/revision guard |
| `packages/desktop/src/lib/services/acp-types.ts` and history client types | Regenerate readiness and first-display summary types | Rust DTOs |
| Existing Rust and TypeScript tests beside each owner | Add characterization, red tests, concurrency tests, and ordering tests | TDD phases below |
| `packages/desktop/scripts/qa/` only if needed | Add a smooth startup timing/ordering probe if current QA CLI cannot prove the contract | Repo QA wrapper |
| `docs/solutions/performance-issues/` | Record the fixed-delay/foreground-enrichment lesson | Verified implementation |

Exact new module names remain subject to existing module size and ownership during implementation, but the ownership boundaries above are fixed.

## Execution Plan

### Phase 1 — Characterize and lock the critical paths

1. Add TypeScript characterization tests around `InitializationManager` that record scheduler registration and show the existing metadata/open requests are delayed; these tests pass against current behavior and document what will be deleted.
2. Add separate desired-behavior tests asserting immediate, selected-panel-first requests; these tests fail before implementation.
3. Add Rust characterization tests around indexed history/startup metadata using transcript fixtures whose reads are detectable; prove the current path consults provider files for usage enrichment.
4. Add Rust session-open characterization covering a current ledger and a missing ledger, including timing and payload bounds.
5. Add an index-coverage audit for configured development projects: per-provider recent candidate coverage, exact restored-id hit rate, placeholder rate, and fallback-title rate. Save the baseline in the implementation notes or solution document; raw row count is not coverage proof.
6. Add a startup diagnostic event sequence assertion that distinguishes shell-ready, metadata-requested, transcript-requested, first-metadata-applied, first-preparing-applied, and first-transcript-applied.

Verification:

- Characterization tests pass before implementation; desired-behavior tests fail for the intended missing behavior before implementation.
- Existing hot-ledger tests remain green and continue proving the 16-row/24-KiB policy.

### Phase 2 — Make canonical metadata immediately readable

1. Add pagination to the persisted-project read. Define bounded per-project and exact-id session-summary DTOs from existing session metadata types; do not include derived provider-history usage.
2. Implement SQLite-only summary repository/command paths: 50-project first page, newest 100 closed sessions per project with 500 aggregate limit, and exact restored ids in selected-first chunks of 32.
3. Remove `enrich_history_entry_usage_stats` from `get_startup_sessions` and indexed `scan_project_sessions` response assembly.
4. Add a one-to-one `session_history_enrichment` table keyed by canonical session id with explicit message/token totals, source mtime/size fingerprint, and enrichment schema version. Indexers write it atomically after provider parsing; first-display summary reads left-join available values without initiating enrichment. No startup migration backfill reads provider files.
5. Return indexed session summaries immediately. Install the `history-index-changed` listener, then schedule provider discovery, missing-project reconciliation, Copilot discovery, placeholder repair, and usage enrichment as background canonical updates. Emit affected ids/paths and revision after atomic metadata/enrichment commits; reread bounded summaries on receipt.
6. Keep explicit refresh commands able to await reconciliation when the caller asks for a completed refresh, but do not use that mode for first display.

Verification:

- Repository/command tests prove zero provider reads on first-display metadata reads.
- Mixed-provider failure tests prove indexed metadata still returns.
- Repository tests prove the 50-project, 100-per-project, 500-session, and 32-exact-id bounds plus pagination/refresh behavior beyond every bound.
- Migration/repository tests prove missing enrichment remains `None`, fingerprint/version invalidation is explicit, and background enrichment becomes visible through a bounded reread.
- Coverage audit after a completed scan proves every discoverable recent candidate in tested bounded pages has one canonical row and every restored id resolves or is explicitly unavailable.

### Phase 3 — Start visible work immediately

1. Replace fixed-delay startup metadata hydration with immediate bounded reads after workspace restoration. Start the selected exact-session read first; run project and first summary pages with a maximum of two concurrent metadata commands; page remaining restored ids in 32-id chunks after first display.
2. Apply exact restored-session summaries before their panel open requests, while allowing project/session lists to render independently if one restored panel is missing. A missing exact row retains the persisted panel title hint and shows the existing unavailable-session state with retry/close; it does not close the panel or block other panels.
3. Request transcript readiness for the selected restored panel first, then enqueue other visible panels without fixed delay.
4. Delete `RESTORED_PANEL_PRELOAD_IDLE_WORK_DELAY_MS` and the delayed preload scheduler. Keep unrelated low-priority preference/agent/icon work deferred.
5. Keep background warming separate from visible-panel opening; visible panels have priority and do not wait for the generic recent-eight backfill.

Verification:

- Fake scheduler tests prove no five/thirty-second advancement is needed.
- Multiple-panel tests prove the selected panel is first, requests otherwise progress independently, and a missing panel does not block the others.
- Startup trace order tests prove transcript request follows canonical identity resolution directly.

### Phase 4 — Replace foreground cold rebuild with canonical repair readiness

1. Introduce one Rust repair coordinator keyed by canonical session id. It owns a globally bounded weighted-fair queue across selected/manual, visible-background, and backfill classes, deduplicates in-flight work per session, and calls the existing provider load → canonical materialization → row-ledger persistence pipeline. Choose the smallest concurrency bound supported by measurement during implementation; tests inject a deterministic bound. The scheduler must prove bounded service for every non-empty class under continuous higher-priority arrivals.
2. Change session open so a current ledger returns `ready` exactly as today, while a missing/stale ledger starts or joins repair and returns `preparing { repair_ticket }` without awaiting provider parsing.
3. Add a replayable await command for the opaque single-use repair ticket. Stored watch-style completion makes already-completed success/failure immediately observable. Await consumption removes completed ticket state; unclaimed completed tickets expire after 30 seconds; in-flight repair may finish for ledger value even if its ticket is abandoned. Success re-enters the hot-ledger builder and returns the normal canonical `found` result with a fresh open token; failure returns the existing typed session-open error taxonomy.
4. Remove backend `start_auto_reconnect_for_open_result` ownership. After either immediate hot-ledger `found` or repaired `found`, `openPersistedSession` hydrates the current attempt first, then calls `connectSession(canonicalSessionId, { openToken, forceReconnect: true })` exactly once. Missing, error, preparing, stale, or unapplied results never reconnect.
5. Route startup backfill through the same coordinator; delete duplicate rebuild entry points.
6. Preserve the open-token/frontier invariant: after canonical snapshot hydration, reconnect attaches live transport and delivers only post-frontier events.

Verification:

- A blocking provider fixture proves `preparing` returns before the provider is released and measures both time-to-preparing and time-to-found.
- Concurrent opens for the same session prove exactly one provider load/rebuild.
- Success before and after await registration proves completion cannot be missed and the ledger is current before `found` is returned.
- Failure proves retry is possible and no partial provider transcript reaches TypeScript.
- Distinct-session queue tests prove the global concurrency bound, weighted preference, and non-starvation under continuous arrivals.
- Ticket tests prove single-use consumption, already-complete observation, abandonment, and 30-second completed-state cleanup.
- Reconnect tests prove hydrate-before-resume, no reconnect for stale/unapplied results, and at most one resume per open attempt.
- Reconnect/frontier regression tests prove historical replay is not reintroduced.

### Phase 5 — Preserve canonical content during refresh

1. Track whether currently rendered rows belong to the requested canonical session and revision.
2. Do not clear same-session canonical rows when requesting a newer readiness result; mark only ephemeral refresh presentation state.
3. Clear immediately when the panel target changes to another session.
4. Render the existing loading/preparing surface only when the target session has no canonical rows. Use `aria-busy` and a polite status announcement. With retained rows, use the existing status area for refreshing/failure without blocking transcript interaction.
5. Apply the repair-completion snapshot through `SessionOpenHydrator` using the existing attempt and monotonic revision guards.

Verification:

- Same-session refresh test preserves rows until a newer canonical snapshot applies and never treats retained rows as writable authority.
- Cross-session switch test never leaks old rows.
- Stale completion test cannot overwrite a newer panel target or revision.

### Phase 6 — Cleanup, review, and durable learning

1. Delete fixed-delay restored preload code, foreground legacy-rebuild open path, and list-read usage enrichment.
2. Update comments and generated bindings so they describe bounded canonical first-display reads/readiness rather than transparent provider scans.
3. Run GOD architecture check again and verify no dual read, provider branch in TypeScript, or UI repair was added.
4. Run `code-review` against the complete diff and resolve all actionable findings.
5. Add a solution document describing why non-critical enrichment and canonical repair must not sit on first-display reads.

## Verification Matrix

| Requirement | Automated proof | Runtime proof |
|---|---|---|
| R1/R3 no artificial delay | Initialization scheduler and startup trace tests | QA trace timestamps |
| R2 SQLite-only metadata | Rust provider-read sentinel tests | Backend timing/log source labels |
| R4 canonical transcript only | Contract/type tests; no provider payload in TS DTO | DOM rows after canonical readiness |
| R5 non-blocking repair | Blocking-provider concurrency test | Cold-session QA shows preparing before content |
| R6 honest state | Same/cross-session frontend tests | Panel inspection during cold repair |
| R7 progressive enrichment | Mixed provider and late update tests | Sidebar title present before usage/enrichment |
| R8 one architecture | Manual/restore shared-path tests and deletion grep | Manual and restored open traces match |
| R9 bounded/measured | Ledger payload tests and diagnostic assertions | Collected timing fields |
| R10 visible behavior | N/A | Required Tauri QA sequence |

Required commands after implementation:

```bash
cd packages/desktop
bun test <focused TypeScript test files>
bun run check
cd src-tauri
cargo test <focused Rust modules>
cargo clippy --all-targets --all-features -- -D warnings
cd ..
bun run qa doctor
bun run qa observe
bun run qa inspect --selector=<project-and-session-region>
bun run qa inspect --selector=<restored-agent-panel-region>
bun run qa screenshot
```

If the behavior needs transition sampling, add or use a QA command that records startup diagnostic events from process launch through first metadata and transcript/preparing render. Static DOM inspection alone is not sufficient.

## Performance Acceptance Criteria

These are ordering and critical-path criteria, not fragile machine-wide millisecond promises:

1. No fixed timer or idle callback gates the first project/session metadata request.
2. No fixed timer or idle callback gates visible restored-panel transcript readiness requests.
3. Indexed metadata can render before provider discovery/enrichment completes.
4. A current ledger returns a bounded suffix in one foreground request.
5. A cold ledger returns `preparing` without waiting for provider parse/materialization.
6. Startup diagnostics expose elapsed times so regressions can be compared on the same machine.
7. Against the pre-change build on the same machine and fixtures, restored cold-session p50 and p95 time-to-canonical-rows improve by at least 80% (removing the fixed-delay floor), while manual cold-open p50/p95 do not regress by more than 10% and hot-ledger p50/p95 do not regress by more than 5%.

For local QA on the development machine, additionally record observed p50/p95 over repeated warm and cold opens, but do not encode environment-dependent absolute timings as unit-test thresholds.

## Rollback and Recovery

This refactor intentionally has no runtime coexistence switch. Recovery is commit-level:

1. Keep phases in small commits: characterization, bounded metadata reads, immediate scheduling, repair coordinator, frontend readiness, cleanup.
2. If a phase fails before merge, revert that phase commit; do not reintroduce UI provider fallbacks or parallel authorities.
3. The metadata phase is locally complete only with its background reconciliation notification/reread path intact; it is not merged or deployed separately from the clean replacement.
4. The repair phase is locally complete only when hot-ledger, cold-preparing, replayable completion, failure/retry, and queue-priority tests pass. It is not merged or deployed while the old foreground path still exists.
5. The enrichment-table migration is forward-only and empty by default. Do not perform provider-file backfill during migration or blocking startup; background index work fills it progressively.

## Risks

- **Cold sessions could remain in preparing forever.** Mitigate with typed repair lifecycle, retry, dedup cleanup on completion/failure, and QA of failure/retry.
- **Background discovery could race indexed first-display reads and overwrite newer in-memory state.** Merge by canonical id and metadata revision/timestamp; never replace the entire store from a stale scan snapshot.
- **Keeping same-session rows could accidentally show content after switching panels.** Guard preservation by canonical session id and request token, with a cross-session regression test.
- **Repair completion could race reconnect.** Preserve the open-token/frontier reservation and attach only after canonical snapshot hydration.
- **Usage stats could appear later or temporarily be absent.** This is intentional progressive enrichment; titles and navigation have priority.
- **Large provider stores could still consume background I/O.** Bound concurrency and prioritize visible-session repairs above global discovery/backfill.
- **Repair tickets could leak.** Make tickets single-use, remove on await consumption, and expire completed unclaimed state after 30 seconds while allowing useful ledger repair to finish.
- **Existing dirty worktree could cause overlap.** The currently dirty files are unrelated; re-check diffs before each edit and never overwrite user changes.

## Review Status

- GOD architecture pre-flight: completed during planning; authority classifications are recorded above.
- Document review: completed in two headless passes; coherence, feasibility, product, design, scope, and adversarial findings resolved in this plan.
- Implementation approval: pending reviewed plan.
