---
title: "perf: Optimize startup session scan cold path from 500ms to <100ms"
type: refactor
status: active
date: 2026-03-24
deepened: 2026-03-24
---

# Startup Session Scan Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Reduce Claude session JSONL fallback scan latency without changing scan results, callback semantics, or indexer behavior, and prove the improvement with deterministic and live benchmarks.

**Architecture:** Keep one canonical metadata parser and separate parsing logic from I/O strategy. Optimize the cold fallback path in small, measurable steps: first instrument and remove redundant cache work, then switch the scan path to a shared blocking parser core, and only introduce broader concurrency or tag-stripping changes if profiling still shows they are necessary.

**Tech Stack:** Rust, Tokio, Rayon, serde_json, Tauri, existing session JSONL cache and startup benchmarks

---

## Scope and guardrails

- Preserve behavior in `packages/desktop/src-tauri/src/session_jsonl/parser/scan.rs`
- Preserve current open-failure semantics: unreadable or missing files must continue to return `Ok(None)`, not fail the full scan
- Preserve `scan_projects_streaming()` observable behavior unless an explicit follow-up decision changes the contract
- Do not migrate `packages/desktop/src-tauri/src/history/indexer.rs` to a new execution path in the first pass unless the shared parser core makes it trivial
- Do not replace `strip_artifact_tags()` with a custom parser unless post-optimization profiling still shows it is a material bottleneck
- Prefer small, reversible changes with benchmark gates between phases

## Success criteria

- Claude fallback scan is measurably faster in `packages/desktop/src-tauri/tests/startup_scan_benchmark.rs`
- Full startup simulation improves in `packages/desktop/src-tauri/tests/startup_scan_benchmark.rs:683`
- No scan output regression:
  - same sessions returned
  - same `display`
  - same `timestamp`
  - same `project`
  - same final ordering
- No callback regression in `scan_projects_streaming()`:
  - same entries emitted as returned
  - ordering is explicitly tested
  - mixed cache-hit/cache-miss behavior is covered
- Existing parser edge cases still pass in `packages/desktop/src-tauri/src/session_jsonl/parser/tests.rs`
- Warm cache path and SQLite index fast path do not regress

## Task 1: Add timing instrumentation and baseline evidence

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_jsonl/parser/scan.rs`
- Modify: `packages/desktop/src-tauri/tests/startup_scan_benchmark.rs`

**Goal:** Prove where time is actually spent before changing architecture.

**Step 1: Add scoped timing around scan phases**
- Measure separately:
  - directory enumeration
  - cache lookup work
  - metadata parse work
  - callback emission
  - sort time
- Keep instrumentation lightweight and debug-oriented.

**Step 2: Add a benchmark view for valid vs skipped files**
- Extend the benchmark breakdown so it can report:
  - total files visited
  - valid entries parsed
  - skipped files
  - per-file timing for parse attempts

**Step 3: Add a benchmark note for live-benchmark limitations**
- Document in the benchmark output/comments that these tests are observational, not deterministic cold-cache proof.

**Step 4: Verify baseline**
Run:
```bash
cargo test -p acepe-lib --test startup_scan_benchmark phase_breakdown -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark multi_agent_scan -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark startup_simulation -- --nocapture
```

**Expected outcome**
- Clear baseline for Claude-only scan and full startup simulation
- Evidence showing whether parse, cache re-stat, or tag stripping dominates

## Task 2: Create one canonical parser core

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_jsonl/parser/scan.rs`
- Test: `packages/desktop/src-tauri/src/session_jsonl/parser/tests.rs`

**Goal:** Eliminate future drift between async and sync extraction paths.

**Design**
- Extract the JSONL line parsing logic into one shared blocking/core function
- Keep wrappers thin:
  - current async API stays available
  - future blocking scan path can reuse the same parser core
- Preserve current semantics exactly

**Step 1: Identify the parser-only logic**
- Separate:
  - file open / line reading
  - line-to-`Value` parse and metadata extraction
  - final `HistoryEntry` assembly

**Step 2: Refactor to a shared core**
- The shared core should own:
  - first-message detection
  - first meaningful user message detection
  - UUID filename fallback
  - timestamp extraction
  - project extraction
  - malformed-line skip behavior

**Step 3: Keep async wrapper behavior identical**
- `extract_thread_metadata()` must still:
  - return `Ok(None)` on open failure
  - skip malformed lines
  - log malformed JSON line previews as it does now

**Step 4: Add parity-focused tests**
Add or update tests for:
- unreadable/missing file returns `Ok(None)`
- empty UUID file
- empty non-UUID file
- assistant-first, then user
- assistant-only
- malformed leading line, then valid user line
- missing `sessionId` with UUID filename fallback
- meta-only / command-only / warmup-only sessions
- very large first user line

**Step 5: Verify parser parity**
Run:
```bash
cargo test -p acepe-lib session_jsonl::parser::tests -- --nocapture
```

**Expected outcome**
- One source of truth for metadata extraction
- No duplicated async/sync parser logic

## Task 3: Remove redundant cache metadata work

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_jsonl/cache.rs`
- Modify: `packages/desktop/src-tauri/src/session_jsonl/parser/scan.rs`
- Test: `packages/desktop/src-tauri/src/session_jsonl/parser/tests.rs`
- Test: `packages/desktop/src-tauri/tests/startup_scan_benchmark.rs`

**Goal:** Reuse already-known `mtime` and `size` from directory enumeration instead of re-stat'ing each file in cache lookup.

**Design**
- Introduce a metadata-aware cache lookup API
- Scan code already has `(path, mtime, size)` from directory enumeration
- Cache hit checks should compare against those values directly

**Step 1: Add a metadata-aware cache check**
- Add a new cache method that accepts:
  - `path`
  - `mtime`
  - `size`
- It should return cached data if unchanged, without calling `tokio::fs::metadata()`

**Step 2: Update scan code to use the new cache path**
- In `scan_projects_streaming()`, use directory-entry metadata once
- Do not immediately delete the old cache API if it is still used elsewhere

**Step 3: Consider negative-result caching**
- If profiling shows invalid/skipped files are repeatedly expensive, add a follow-up plan or a narrow extension to remember `no valid entry for this file at this mtime/size`
- Keep this optional and gated by data

**Step 4: Verify no behavior change**
Run:
```bash
cargo test -p acepe-lib session_jsonl::parser::tests -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark cache_effectiveness -- --nocapture
```

**Expected outcome**
- Lower stale-cache scan overhead
- Better hit/miss accounting
- Fewer redundant syscalls

## Task 4: Switch the scan fallback path to the shared blocking parser core

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_jsonl/parser/scan.rs`
- Test: `packages/desktop/src-tauri/src/session_jsonl/parser/tests.rs`
- Test: `packages/desktop/src-tauri/tests/startup_scan_benchmark.rs`

**Goal:** Remove per-file async file-read overhead from the cold fallback scan without changing parser behavior.

**Design**
- Use the shared parser core from Task 2
- Apply it only to the scan fallback path first
- Keep indexer behavior unchanged unless the shared core cleanly applies there later

**Step 1: Introduce a blocking file-read wrapper for scan use**
- Open file with `std::fs::File`
- Read lines with `std::io::BufRead`
- Preserve current `skip on open failure` semantics

**Step 2: Keep `scan_projects_streaming()` callback behavior explicit**
- Do not silently switch to fully batched callbacks
- Either:
  - preserve progressive emission, or
  - collect, sort, then emit in one consistent order and update tests/callers accordingly
- This plan assumes preserving current observable semantics unless measurement proves otherwise and product behavior is explicitly accepted

**Step 3: Keep concurrency conservative at first**
- Replace per-file async parse work with the shared blocking parser core
- Do not add Rayon yet if the benchmark is already close to target
- If needed, keep concurrency bounded and measurable

**Step 4: Add callback/order tests**
Cover:
- all cache hits
- all cache misses
- mixed hits and misses
- multiple projects
- equal timestamps
- callback entries equal returned entries

**Step 5: Verify performance and correctness**
Run:
```bash
cargo test -p acepe-lib session_jsonl::parser::tests -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark cold_scan -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark phase_breakdown -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark startup_simulation -- --nocapture
```

**Expected outcome**
- Cold fallback path gets materially faster
- No parser drift
- No callback/order regression

## Task 5: Decide whether Rayon is still necessary

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_jsonl/parser/scan.rs` only if needed
- Test: `packages/desktop/src-tauri/tests/startup_scan_benchmark.rs`

**Goal:** Add broader parallelism only if Tasks 2-4 do not achieve the target.

**Decision gate**
- If cold Claude fallback scan and startup simulation are already acceptable, skip this task
- If still too slow, benchmark a bounded Rayon-based parse phase

**Step 1: Prototype bounded blocking parallelism**
- Use one `spawn_blocking` boundary if needed
- Keep thread count bounded; do not assume CPU-count threads are optimal
- Measure against current multi-agent startup behavior

**Step 2: Compare against full startup, not just Claude**
Run:
```bash
cargo test -p acepe-lib --test startup_scan_benchmark multi_agent_scan -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark startup_simulation -- --nocapture
```

**Step 3: Accept only if startup wall time improves**
- Reject Rayon if Claude-only scan improves but full startup regresses or becomes noisy under parallel agent scans

**Expected outcome**
- Parallelism is introduced only if it helps the real user-visible path

## Task 6: Re-profile tag stripping before rewriting it

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_jsonl/parser/text_utils.rs` only if needed
- Test: `packages/desktop/src-tauri/src/session_jsonl/parser/tests.rs`
- Test: `packages/desktop/src-tauri/tests/startup_scan_benchmark.rs`

**Goal:** Avoid a risky custom tag parser unless the benchmark still proves `strip_artifact_tags()` is a meaningful bottleneck.

**Step 1: Measure current tag-stripping cost after previous optimizations**
- Re-run phase breakdown after Tasks 2-4
- Determine whether tag stripping is still materially visible in end-to-end timing

**Step 2: Try the smallest safe fix first**
Potential options, in order:
- cheaper fast path
- precompiled/cached patterns
- narrower handling for known heavy tags
- only then consider a custom parser

**Step 3: If a custom parser is still needed, require a golden parity suite**
Add coverage for:
- nested tags
- repeated same-name tags
- attributes
- malformed closers
- unclosed tags
- literal `<` text
- unicode text around tags
- current real-world artifact tags

**Step 4: Compare old vs new behavior directly**
- Keep the old implementation available during test comparison if practical
- Prove identical output on a corpus of representative inputs before switching

**Step 5: Verify value**
Run:
```bash
cargo test -p acepe-lib session_jsonl::parser::tests -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark phase_breakdown -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark cold_scan -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark startup_simulation -- --nocapture
```

**Expected outcome**
- Tag-stripping complexity only increases if the measured payoff justifies it

## Task 7: Final validation and threshold update

**Files:**
- Modify: `packages/desktop/src-tauri/tests/startup_scan_benchmark.rs`
- Review: `packages/desktop/src-tauri/src/session_jsonl/parser/scan.rs`
- Review: `packages/desktop/src-tauri/src/session_jsonl/cache.rs`
- Review: `packages/desktop/src-tauri/src/session_jsonl/parser/text_utils.rs`

**Goal:** Lock in the new baseline only after correctness and startup impact are proven.

**Step 1: Validate parser and scan correctness**
Run:
```bash
cargo test -p acepe-lib session_jsonl::parser::tests -- --nocapture
```

**Step 2: Validate benchmark improvements**
Run:
```bash
cargo test -p acepe-lib --test startup_scan_benchmark cold_scan -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark warm_scan -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark cache_effectiveness -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark multi_agent_scan -- --nocapture
cargo test -p acepe-lib --test startup_scan_benchmark startup_simulation -- --nocapture
```

**Step 3: Validate broader Rust quality**
Run:
```bash
cargo test -p acepe-lib
cargo clippy --manifest-path packages/desktop/src-tauri/Cargo.toml --all-targets --all-features
```

**Step 4: Update benchmark commentary and expectations**
- Only update comments/targets after numbers are stable enough to justify them
- Keep live benchmark caveats explicit

**Expected outcome**
- Measured improvement with no hidden correctness regressions

## Notes for implementation

- `packages/desktop/src-tauri/src/history/indexer.rs` currently uses `extract_thread_metadata()`. Do not create a second long-lived parser implementation just to optimize scan.
- `packages/desktop/src-tauri/src/session_jsonl/parser/scan.rs` already contains both the parser entry point and scan orchestration; keep the shared-core extraction local unless a cleaner module split becomes obviously worthwhile.
- `packages/desktop/src-tauri/src/session_jsonl/parser/tests.rs` already has strong coverage for many title-extraction cases; extend it rather than creating a second parallel suite.
- `packages/desktop/src-tauri/tests/startup_scan_benchmark.rs` already includes:
  - cold scan
  - warm scan
  - phase breakdown
  - multi-agent scan
  - startup simulation
  Reuse those as the primary validation surface.

## Explicit non-goals for this plan

- Rewriting the SQLite index fast path
- Changing session title heuristics
- Changing the UI contract for progressive updates without separate approval
- Migrating unrelated scanners
- Introducing a custom XML/tag parser before profiling proves the need

## Recommended execution order

1. Task 1: baseline instrumentation
2. Task 2: shared parser core
3. Task 3: metadata-aware cache lookup
4. Task 4: blocking scan path
5. Re-benchmark
6. Task 5: bounded Rayon only if still needed
7. Task 6: tag stripping rewrite only if still needed
8. Task 7: final validation

## Expected checkpoint decisions

- **Checkpoint A:** After Task 1, confirm actual dominant cost
- **Checkpoint B:** After Task 4, decide whether Rayon is still needed
- **Checkpoint C:** After Task 5, decide whether tag stripping is still worth changing
- **Checkpoint D:** After Task 7, decide whether benchmark thresholds should be updated
