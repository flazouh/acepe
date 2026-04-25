---
title: Enable 1M context for Claude Sonnet and remove legacy claude-agent-acp sidecar
type: feat
status: active
date: 2026-04-15
---

# Enable 1M context for Claude Sonnet and remove legacy claude-agent-acp sidecar

## Overview

One rollout change is in scope now, with one documented follow-up cleanup:

1. **Part 1 — Default Sonnet sessions to 1M context on the live Claude path.** Acepe currently shows `200k` for Claude Sonnet sessions because it faithfully displays the real `modelUsage.<model>.contextWindow` value emitted by the Claude CLI. Terminal testing in this session showed that `--betas context-1m-2025-08-07` is ignored in the current non-API-key auth mode, while `--model claude-sonnet-4-6[1m]` is recognized by the Claude CLI. This plan pivots Part 1 to request 1M using Claude's model-suffix contract (`[1m]`) on Sonnet sessions, then continue to display whatever real `modelUsage` Claude returns.
2. **Part 2 — Remove dead `@zed-industries/claude-agent-acp` sidecar path.** Before the native Rust `cc-sdk` existed, Acepe ran Claude through a sidecar built from `@zed-industries/claude-agent-acp` (patched fork). That path is no longer dispatched — `ClaudeCodeProvider` uses `CommunicationMode::CcSdk` which bypasses `spawn_configs()` entirely. The `packages/acps/claude` package is still built, tested, and released but has no runtime consumer in the desktop app. Delete the package, its patch, and its release workflow. The orphan-sweep reference can be cleaned up in the same follow-up PR if transition-risk review stays green, or deferred one release if needed.

Part 1 is the user-facing change and must be verified first. Part 2 is follow-up cleanup that proceeds only after Part 1 is proven end-to-end; if Part 1 uncovers extra runtime work, Part 2 moves to a separate follow-up PR without blocking the 1M rollout. For planning purposes, rollout completion is reached when Unit 1 is green; Unit 2 is maintenance follow-up, not a blocker for shipping Part 1, and is not bundled into the rollout PR.

## Problem Frame

**Part 1.** Users running Sonnet 4.5/4.6 expect 1M context, but Acepe's chip currently shows `used / 200000` because it accurately passes through what the Claude CLI reports today. This is not a parser bug. It is a runtime request-shape problem. Local terminal testing established two important facts: (a) the beta-header path is ignored in the current Claude auth mode, and (b) the CLI does recognize the `[1m]` model suffix, but may reject it when the Claude account lacks the required extra-usage entitlement. So the implementation target is now: request Sonnet as `model + "[1m]"`, keep the UI/pass-through path dumb, and fall back to plain Sonnet only for the explicit 1M-entitlement error instead of failing the whole launch. To keep rollout deterministic, Claude runtime selection is also narrowed to the managed cached install only; PATH-based `claude` / `claude-code` fallback is removed from scope.

**Part 2.** The sidecar's presence is a cognitive-load tax: there are two Claude code paths in the repo, a pile of historical machinery (install, build, patch, release, and old cleanup scaffolding) devoted to one that no longer ships. Every time someone investigates Claude behavior — like the root-cause tracing that motivated Part 1 — they have to re-prove which path is live. Delete it in a follow-up cleanup once the user-facing rollout is stable.

## Requirements Trace

**Rollout requirements (Part 1):**
- **R1.** When the active Claude session is running a Sonnet 4/4.5/4.6 model and the Claude runtime honors 1M mode, the context budget surfaced in the metrics chip (`model-selector.metrics-chip.svelte`) reports `1_000_000` as `maxTokens`.
- **R2.** Opus and Haiku sessions continue to report `200_000` — no regression for non-Sonnet models.
- **R3.** The 1M request is active on the real Claude call path, not cosmetic in the UI. Acepe must request Sonnet using Claude's `[1m]` model-suffix contract; no parser-side lying.
- **R6.** No user-facing regression in launching a Claude Code session (happy path: new session spawns, first turn completes, context chip populates).
- **R7.** The relevant `CHANGELOG.md` entry (and therefore generated GitHub release notes) explicitly discloses that Acepe now requests Sonnet 1M context where Claude supports it, may fall back to standard Sonnet context based on Claude account entitlement/runtime response, and now relies on Acepe's managed Claude install rather than PATH fallback.
- **R8.** The existing composer-adjacent install/progress card is the only upgrade/install surface used for Claude. Missing Claude and outdated Claude both reuse that same card-driven flow, and its copy explicitly states that Acepe now uses its managed Claude install rather than `claude` / `claude-code` binaries found on PATH.
- **R9.** If Claude rejects `model[1m]` with the explicit extra-usage / entitlement error, Acepe falls back once to the standard Sonnet model for that launch and continues. No retry loop, no hard failure, and no synthetic `1_000_000` display.
- **R10.** Claude Code runtime discovery and availability checks use only the managed cached Claude install (`get_cached_binary(ClaudeCode)`). PATH-based fallback to `claude` / `claude-code` is removed.
- **R11.** When no managed Claude binary is installed yet, or the managed binary is below the minimum supported floor, Acepe auto-repairs through the existing managed install path and existing progress-card surface instead of failing open to PATH fallback.
- **R12.** Acepe enforces a minimum managed Claude CLI semver floor known to support the `[1m]` model-suffix path. If the cached managed Claude binary is below that floor, Acepe repairs it through the existing managed install path before launch.
- **R13.** Non-launch Claude helper paths (`query.rs` / `sessions.rs`) do not need to auto-repair missing or outdated managed installs. They may fail with a repairable managed-runtime error, but they must not silently fall back to PATH or claim to inherit `client_factory`'s launch-time auto-install behavior.

**Follow-up cleanup requirements (Part 2, non-blocking for rollout):**
- **R4.** `packages/acps/claude` and its patch file no longer exist in the tree, and no launch/build/test/release path in desktop or automation depends on the removed package. A transition-only orphan-sweep string may remain for one release if needed for stale-process cleanup.
- **R5.** Root `bun test`, `bun run check` in `packages/desktop`, and the backend CI Rust checks (`cargo clippy --all-targets --no-default-features -- -D warnings` and `cargo test --no-default-features -- --skip claude_history::export_types`) pass after the sidecar deletion.

## Scope Boundaries

**In scope for rollout (Part 1):**
- Derive a Claude API model ID for Sonnet sessions that uses the `[1m]` suffix on the live Claude path, while keeping Acepe's displayed/stored model IDs canonical.
- Remove PATH-based Claude runtime fallback so the managed cached Claude install is the only supported Claude launch/discovery path.
- Enforce a minimum managed Claude CLI version floor for the 1M rollout rather than accepting stale cached Claude installs.
- Reuse the existing composer-adjacent install/progress card for both missing-Claude install and outdated-Claude upgrade flows.
- Add a `CHANGELOG.md` note that discloses the 1M request behavior, possible entitlement-based fallback to standard Sonnet, and managed-install-only Claude runtime support.
- Fall back once from `model[1m]` to standard Sonnet when Claude returns the explicit extra-usage / entitlement error.

**Documented follow-up cleanup (Part 2, separate PR required):**
- Delete `packages/acps/claude/` (src, patches, tests, package.json, CHANGELOG, README, lockfiles).
- Delete `.github/workflows/release-claude-acp.yml`.
- Remove the `bun run --cwd packages/acps/claude test:run` tail from the root `package.json` test script.

**Out of scope (non-goals):**
- UI toggle for 1M context. User chose "always-on for Sonnet" — no settings surface.
- Parser-side override in `cc_sdk_bridge.rs` / `shared_chat.rs`. No fallback layer that could lie about the real API state.
- In-product Sonnet cost warning toast/modal. User explicitly chose to keep that responsibility on the user; disclosure is release-note/documentation only.
- Deleting `install_claude_cli` or `CanonicalAgentId::ClaudeCode` — those still install the real Claude CLI binary (not the sidecar) and are live dependencies of `resolve_claude_spawn_configs` / `model_discovery_commands`.
- Updates to `packages/acps/` for other providers (codex, opencode). Only `claude/` is deleted; leaving the empty `packages/acps/` parent in place is acceptable because removing it is cosmetic only.
- Any change to `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts` or the metrics chip. The TS display layer already does the right thing — it passes through whatever the Rust side reports.

## Context & Research

### Relevant Code and Patterns

**Part 1 — 1M context:**
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs:1164-1253` — `build_options()` constructs the live `ClaudeCodeOptions` used by `ClaudeSDKClient::new`. This is the runtime hook point for setting the API model ID on first launch.
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs:1514-1524, 2518-2520` — runtime model switches currently pass the selected model ID straight through to `set_model(...)`. The pivot requires one Claude-specific API-model mapping seam for both initial launch and later switches.
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs:1232-1233, 1382-1383` — `pending_model_id` is currently both the requested runtime model and the model reflected back into session state. The 1M pivot needs canonical model IDs in Acepe state/UI and derived API model IDs only at the Claude runtime edge.
- `packages/desktop/src-tauri/src/cc_sdk/transport/subprocess.rs:1137-1228` — current live Claude CLI resolver still searches PATH and common system locations before the SDK cache. This is the real seam that must change for true managed-install-only Claude runtime behavior.
- `packages/desktop/src-tauri/src/cc_sdk/transport/subprocess.rs:630-682` — current CLI version check parses semver and warns only. This is the natural seam to keep as defense-in-depth while actual enforcement happens through managed-install availability.
- `packages/desktop/src-tauri/src/cc_sdk/query.rs:153` and `packages/desktop/src-tauri/src/cc_sdk/sessions.rs:76,122,166,194` — ancillary cc-sdk entry points also call `find_claude_cli()`, so managed-only runtime resolution must hold across query/session helpers, not just the primary transport constructor.
- `packages/desktop/src-tauri/src/acp/client_factory.rs:32-38` — built-in auto-install path: if Claude is auto-installable and unavailable, client creation installs the managed Claude runtime before launching.
- `packages/desktop/src-tauri/src/acp/registry.rs:188-203` — Claude remains an installable built-in agent even when unavailable, which gives the UI a concrete managed-install recovery state instead of a dead-end unavailable state.
- `packages/desktop/src/lib/acp/store/agent-store.svelte.ts:106-124` — desktop manual install/repair path already exists via `installAgent(agentId)` and refreshes agent availability after success.
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` plus `packages/desktop/src/lib/acp/components/agent-panel/components/agent-install-card.svelte` — existing composer-adjacent install card already renders agent install progress and should be reused for both first install and upgrade.
- `packages/desktop/src-tauri/src/cc_sdk/types.rs:2020-2027` — `modelUsage` field in `Result` message; comment confirms "Per-model usage metadata emitted by the Claude CLI result payload."
- `packages/desktop/src-tauri/src/cc_sdk/message_parser.rs:537-562` — existing test `test_parse_result_message_preserves_model_usage` proves the pass-through is intact. Test currently asserts `200000`; keep the existing test. A `1000000` sibling is optional extra coverage, not a Unit 1 requirement.
- `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs:785-790` — `context_window_size` extraction from `modelUsage.<model>.contextWindow`. Pure pass-through.
- `packages/desktop/src-tauri/src/acp/parsers/shared_chat.rs:222-301` — `extract_result_context_window`. Hard boundary: no model-based synthesis (tests at `cc_sdk_bridge.rs:1076-1116` explicitly forbid guessing).

**Part 2 — Sidecar removal:**
- `packages/desktop/src-tauri/src/acp/providers/claude_code.rs:25-49` — Provider returns `CommunicationMode::CcSdk`. `spawn_config()` / `spawn_configs()` are trait stubs ("Not used for CcSdk mode, but trait requires it" comment).
- `packages/desktop/src-tauri/src/acp/client_factory.rs:40-79` — Dispatch table. `CommunicationMode::CcSdk` branch calls `ClaudeCcSdkClient::new(provider, ...)` and never touches `spawn_configs()`. This is the proof that the sidecar is dead at runtime.
- `packages/desktop/src-tauri/src/acp/client/lifecycle.rs:72-80` — `spawn_configs()` is only consumed by the `Subprocess` path (legacy ACP). Claude Code uses `CcSdk`, bypassing this entirely.
- `packages/desktop/src-tauri/src/acp/agent_installer.rs:138, 345-346` — `CanonicalAgentId::ClaudeCode → AgentSource::ClaudeCli → install_claude_cli`. Installs the real `claude` CLI, NOT the sidecar. Removing `packages/acps/claude` does not break this path.
- `packages/desktop/src-tauri/src/acp/providers/claude_code.rs:55-69, 220-256` — current Claude provider still falls back to `command_exists("claude")`, `command_exists("claude-code")`, and an `unwrap_or(SpawnConfig { command: "claude", ... })` default in model discovery. This plan now removes those PATH fallbacks so the managed cached install is the only supported Claude runtime.
- `packages/desktop/src-tauri/src/lib.rs:339-347` — `orphaned_acp_process_patterns` hardcodes `"{agents_dir}/claude-code/claude-agent-acp"`. This is only a startup cleanup belt-and-suspenders path now; it is not part of the live launch/build/test/release surface and can survive one transition release if needed.
- `package.json:16` — root test script includes `&& bun run --cwd packages/acps/claude test:run`. Must be removed when the package is deleted or root `bun test` breaks.
- `.github/workflows/release-claude-acp.yml` — entire workflow dedicated to building/releasing the dead sidecar. Delete.
- `.github/workflows/release.yml` — main release workflow. Already verified to contain no `acps/claude` references (grep confirmed).
- `packages/acps/claude/` directory contents (src, patches/, package.json, bun.lock, package-lock.json, README.md, CHANGELOG.md, tsconfig, tests). All dead.
- `packages/acps/` parent — only contains `claude/`. Leaving the empty parent in place is acceptable; deleting it is cosmetic only and not required for this plan.

### Institutional Learnings

- `docs/solutions/` — quick scan found no relevant prior art for Claude `[1m]` model-suffix handling or sidecar removal. No institutional guidance to carry forward.

### External References

- Local terminal evidence from this session:
  - `claude --betas context-1m-2025-08-07` warns `Custom betas are only available for API key users. Ignoring provided betas.`
  - `claude --model 'claude-sonnet-4-6[1m]'` is recognized by the CLI and returns the explicit entitlement error `Extra usage is required for 1M context ... or use --model to switch to standard context`.
- `pingdotgg/t3code` uses Claude's `[1m]` model-suffix contract instead of beta headers:
  - `packages/shared/src/model.ts` maps Claude `contextWindow: "1m"` to `model + "[1m]"` via `resolveApiModelId(...)`
  - `apps/server/src/provider/Layers/ClaudeAdapter.ts` passes that derived API model ID into live Claude query/set-model calls

## Key Technical Decisions

- **Use Claude's `[1m]` model-suffix contract on the live session path, not parser overrides or beta headers.** The widget number must reflect real API behavior, not a cosmetic lie, and the terminal evidence in this session showed the beta-header path is ignored in the current auth mode.
- **Always-on for Sonnet, no user toggle.** User-chosen. This keeps the change surface small — no new settings surface, no persistence choice, no UI gate.
- **Keep Acepe model IDs canonical; derive Claude API model IDs only at the runtime edge.** Acepe should continue to think in canonical IDs like `claude-sonnet-4-6`; only the request path should derive `claude-sonnet-4-6[1m]`.
- **Fallback once on the explicit entitlement error.** If Claude rejects the `[1m]` request with the known extra-usage / entitlement error, retry-free degradation to plain Sonnet is acceptable. Do not fail the session, do not loop, and do not pretend the context is 1M.
- **No in-product Sonnet cost warning.** User chose to own that responsibility. Disclosure is release-note/documentation only.
- **Part 2 cleanup follows Part 1 verification.** Keep Part 1 and Part 2 in distinct commits. If Part 1 expands beyond the planned runtime change, ship Part 2 in a follow-up PR instead of coupling cleanup to the rollout.
- **Support exactly one Claude runtime: the managed cached install.** Remove PATH fallback to `claude` / `claude-code` in availability and spawn-config resolution so the 1M rollout targets one deterministic Claude binary.
- **Use a minimum managed CLI version floor, not a pinned exact build.** Enforce the floor via `is_available()` in `claude_code.rs`: when the managed binary exists but reports a version below the floor, `is_available()` returns `false`, causing `client_factory`'s existing auto-install gate to repair the install before launch. The existing `check_cli_version()` in cc-sdk transport stays as a defense-in-depth warning log, not the enforcement point.
- **Reuse the existing managed install/repair flow and existing progress card.** Missing cached Claude binaries and outdated cached Claude binaries both recover through Acepe's existing managed agent install path and the same card surface above the composer, not through PATH fallback and not through a new bespoke recovery UI.
- **No deletion of `install_claude_cli`, `CanonicalAgentId::ClaudeCode`, or `resolve_claude_spawn_configs`.** These still serve the real Claude CLI install flow. The required deletions are the dead sidecar package plus its launch/build/release byproducts; orphan-sweep cleanup is optional follow-up if transition-risk review stays green.

## Open Questions

### Resolved During Planning
- *Is the `claude-agent-acp` sidecar path actually dead?* Yes. `CommunicationMode::CcSdk` dispatch in `client_factory.rs:61-79` goes directly to `ClaudeCcSdkClient`, never touching `spawn_configs()`. `spawn_configs()` is only consumed by the `Subprocess` branch, and Claude does not use it. `is_available()`, `install_claude_cli`, and `get_cached_binary(ClaudeCode)` all operate on the real Claude CLI binary, not the sidecar.
- *Will removing `packages/acps/claude` break the root `bun test`?* Yes, unless `package.json:16` is edited in the same commit. Plan includes the edit.
- *Does the main `release.yml` workflow reference the sidecar?* No — grep confirmed.
- *Does `install_claude_cli` depend on the sidecar?* No — it downloads the Claude CLI from Anthropic's release channel.
- *What is the correct hook for requesting 1M on live Claude sessions?* The Claude runtime model selection seam in `ClaudeCcSdkClient`: initial `build_options()` model assignment plus later `set_model(...)` calls. The selected canonical Sonnet model must be mapped to `model + "[1m]"` only at that runtime edge.
- *Should 1M be requested with beta headers?* No. Terminal testing in this session showed that `--betas context-1m-2025-08-07` is ignored in the current auth mode, while `model[1m]` is recognized.
- *Should Acepe fail when 1M entitlement is missing?* No. If Claude returns the explicit extra-usage / entitlement error for `[1m]`, fall back once to standard Sonnet and continue.
- *How should cost disclosure reach users?* Release-note / changelog disclosure only. No in-product warning toast or modal.
- *Which Claude binary should Acepe support for this rollout?* The managed cached Claude install only. Remove PATH fallback to `claude` / `claude-code` so runtime behavior is deterministic.
- *How should missing managed Claude installs behave after PATH fallback removal?* Claude is unavailable until the managed install is present. Provider availability, spawn-config helpers, and model discovery must handle that state without panicking, while the existing managed install flow remains the recovery path.
- *Should Acepe pin one exact Claude build or enforce a version floor?* Enforce a minimum managed semver floor known to support the `[1m]` model-suffix path; do not pin one exact build unless rollout evidence later proves semver alone is insufficient.

### Deferred to Implementation
- **Whether to also delete the empty `packages/acps/` parent directory.** Cosmetic only. Leaving it in place is acceptable; do not treat it as required cleanup.
- **Whether `cfg(test)`-only `context_window_for_model()` in `cc_sdk_bridge.rs:676-695` should also be deleted** (it asserts the old 200k assumption). It's dead code even today, but defer that cleanup to Unit 2 or another follow-up unless Unit 1 cannot complete without touching it.
- **Whether to remove the `claude-agent-acp` orphan-sweep pattern in the same cleanup PR.** Not required for rollout. Safe default is to leave it for one transition release and remove it later once stale-upgrade concerns are gone.

## Implementation Units

- [ ] **Unit 1: Enable 1M Claude context via model-suffix selection**

**Goal:** When Acepe launches or switches a Claude Sonnet session through the live cc-sdk path, the runtime request uses Claude's `[1m]` model suffix so the real `result.modelUsage.<sonnet-id>.contextWindow` payload reports `1_000_000` when Claude honors it. If Claude returns the explicit extra-usage / entitlement error for `[1m]`, Acepe falls back once to standard Sonnet and continues. Nothing downstream synthesizes the number — the existing parser pass-through surfaces the real returned value automatically.

**Requirements:** R1, R2, R3, R6, R7, R8, R9, R10, R11, R12, R13

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs` — add a Claude API-model mapping seam used by `build_options()`, `apply_runtime_model()`, and deferred-connection `set_session_model()` pending-options rebuilds
- Modify: `packages/desktop/src-tauri/src/acp/providers/claude_code.rs` — remove PATH fallback from `is_available()`, `resolve_claude_spawn_configs()`, and the `model_discovery_commands()` default fallback spawn config
- Modify: `packages/desktop/src-tauri/src/cc_sdk/transport/subprocess.rs` — rewrite `find_claude_cli()` to delegate to `agent_installer::get_cached_binary(ClaudeCode)` exclusively (removing PATH search, `cc_sdk::cli_download` cache, and hardcoded locations); keep `check_cli_version()` as defense-in-depth warning only
- Modify (if needed): `packages/desktop/src-tauri/src/cc_sdk/query.rs` and `packages/desktop/src-tauri/src/cc_sdk/sessions.rs` — keep ancillary Claude CLI entry points aligned with managed-install-only resolution if they still call the shared resolver directly
- Modify: `packages/desktop/src/lib/acp/store/agent-store.svelte.ts` and/or the existing install-state wiring if the upgrade path needs the current install card to render "upgrade" and "install" through the same surface
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` and related card tests only if the current card copy/state model cannot already represent an upgrade plus the managed-install-only explanation
- Modify (test): `packages/desktop/src-tauri/src/acp/providers/claude_code.rs` — update/add provider tests so availability, spawn config resolution, and model discovery no longer fall back to PATH command names
- Modify (test): `packages/desktop/src-tauri/src/cc_sdk/transport/subprocess.rs` — cover managed-only CLI resolution and below-floor managed Claude version behavior
- Modify (if needed): `packages/desktop/src-tauri/src/cc_sdk/query.rs` and `packages/desktop/src-tauri/src/cc_sdk/sessions.rs` — return explicit repairable managed-runtime errors if the managed Claude binary is missing or below floor, rather than attempting implicit repair or PATH fallback
- Modify (test): `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs` — cover canonical-model -> API-model mapping, `[1m]` request behavior, and entitlement-error fallback behavior
- Modify: `CHANGELOG.md` — add or update the relevant release entry so generated GitHub release notes disclose the 1M request behavior, possible entitlement fallback, and managed-install-only Claude runtime note
- Optional modify (test): `packages/desktop/src-tauri/src/cc_sdk/message_parser.rs` — add a `test_parse_result_message_preserves_1m_context_window` sibling to the existing `test_parse_result_message_preserves_model_usage` at line 537, asserting `1_000_000` survives the pass-through

**Approach:**
- Introduce a Claude-specific helper that maps canonical Acepe Sonnet model IDs to the Claude API model IDs used on the wire. Treat this as a Sonnet-family mapping (`claude-sonnet-4`, `claude-sonnet-4-5`, `claude-sonnet-4-6`, and future canonical Sonnet IDs surfaced by Acepe) rather than a single hard-coded `4.6` rewrite. Opus and Haiku remain unchanged.
- Use that helper in both the initial `build_options()` path and the later `apply_runtime_model()` / `set_model(...)` path so session creation and mid-session model switches behave the same way.
- Mirror the existing deferred-connection mode-update behavior for model changes: when `set_session_model()` runs before the Claude SDK client is connected, rebuild cached `pending_options` with the newly selected canonical model so the first prompt uses the correct derived Claude API model ID.
- Preserve canonical model IDs in Acepe state/UI. The suffix belongs only on the runtime request path, not in picker state, session identity, or UI labels.
- Detect the explicit Claude entitlement error for `[1m]` (`Extra usage is required for 1M context ... use --model to switch to standard context`) and fall back once to the plain Sonnet model for that launch. Do not retry repeatedly and do not fail the session just because 1M entitlement is missing.
- Narrow Claude runtime resolution to the managed cached install only. Remove `command_exists("claude")`, `command_exists("claude-code")`, and the hardcoded `"claude"` fallback spawn config so availability and model discovery target the same managed binary as session launch.
- Remove PATH/common-location fallback from the live cc-sdk Claude resolver (`find_claude_cli()` or its Acepe-owned equivalent) so session launch, query helpers, and session helpers all target the managed Claude cache rather than whatever `claude` happens to exist on the machine.
- When no managed Claude binary is installed yet, or when the managed binary is below the supported floor, `is_available()` should report unavailable so `client_factory` naturally triggers the existing managed install/upgrade flow and existing composer-adjacent progress card.
- Keep the repair policy asymmetric by design: launch paths auto-repair through `client_factory`, while non-launch helper callers may fail with an explicit managed-runtime repair error. Do not silently broaden helper paths into auto-install flows unless implementation proves that is already required by UX.
- No change to `cc_sdk_bridge.rs` or `shared_chat.rs`. The metrics value still flows through the existing pass-through.
- Keep one end-to-end manual smoke after the code change: launch a Sonnet session from the UI using the managed Claude install and verify the real `modelUsage`-driven chip shows a million-scale budget when Claude honors `[1m]`. Entitlement-fallback live repro is desirable but not mandatory for sign-off; if no non-entitled environment is available, sign-off can rely on targeted automated tests plus the captured terminal evidence already proving Claude's explicit entitlement error shape. Run the same flow with Opus and Haiku to verify they still report `200k`.

**Execution note:** TDD — failing runtime-model-mapping test before the production change, then manual runtime smoke to prove the CLI honors the `[1m]` path end-to-end.

**Technical design:**
> *Directional guidance for review, not implementation specification.*

```
canonical_model_id -> resolve_claude_api_model_id():
    any canonical Sonnet model -> canonical_model_id + "[1m]"
    Opus/Haiku -> unchanged

build_options():
    builder = ClaudeCodeOptions::builder().cwd(...)
    ...
    if pending_model_id:
        builder = builder.model(resolve_claude_api_model_id(pending_model_id))
    options = builder.build()

apply_runtime_model(model_id):
    sdk_client.set_model(Some(resolve_claude_api_model_id(model_id)))
```

**Patterns to follow:**
- `build_options()` and `apply_runtime_model()` in `cc_sdk_client.rs` — preserve the current builder/session flow and add the API-model mapping in one place rather than duplicating string logic
- Existing `build_options_*` tests in `cc_sdk_client.rs` — mirror that style for the new model-mapping assertions
- `pingdotgg/t3code` `resolveApiModelId(...)` pattern — use it as external prior art for the `[1m]` model-suffix contract, not as a wholesale architecture import

**Test scenarios:**
- Happy path: canonical Sonnet model selection is converted to `model[1m]` on the wire for both initial launch and later `set_model(...)` calls. Cover at least `claude-sonnet-4`, `claude-sonnet-4-5`, and `claude-sonnet-4-6`.
- Deferred first-prompt model change: `newSession -> setModel -> first prompt` rebuilds cached `pending_options` so the initial Claude launch uses the newly selected Sonnet/Opus/Haiku model rather than the stale pre-change model.
- Regression: Opus and Haiku model IDs remain unchanged on the wire.
- Canonical-state safety: Acepe session/model state still stores and displays canonical model IDs without `[1m]` suffix leakage into the picker or session model state.
- Entitlement fallback: when Claude returns the explicit 1M extra-usage / entitlement error, Acepe falls back once to standard Sonnet and continues the session without retry looping.
- Runtime selection: Claude provider availability and model discovery succeed only from the managed cached Claude install; no PATH `claude` / `claude-code` fallback remains.
- Cold install / upgrade: with no cached Claude binary present, or with a cached managed Claude binary below the required semver floor, `is_available()` returns `false`, causing `client_factory`'s auto-install gate to fire and route through the existing install/progress card.
- Unified resolution: `find_claude_cli()` returns only the `agent_installer::get_cached_binary(ClaudeCode)` path. All five callers in `query.rs`/`sessions.rs` resolve through this single path.
- Helper-path policy: `query.rs` / `sessions.rs` callers are allowed to fail with explicit managed-runtime repair errors when the managed binary is missing or below floor; they do not silently fall back to PATH and do not claim launch-style auto-repair.
- Integration (manual smoke, not automated): a live Sonnet session launched from the UI produces `result.modelUsage.<sonnet-model-id>.contextWindow == 1000000` when the Claude account/runtime honors `[1m]`.
- Integration (manual, fallback): if the Claude account/runtime rejects `[1m]`, the session still launches on plain Sonnet and the resulting `modelUsage` stays `200000`.
- Integration (manual, regression): the same UI flow with an Opus model still reports `200000` in `modelUsage.<opus-model-id>.contextWindow`, and a Haiku model still reports `200000` in `modelUsage.<haiku-model-id>.contextWindow`.
- Disclosure: the relevant `CHANGELOG.md` entry states that Acepe now requests Sonnet 1M where supported, may fall back to standard context depending on Claude entitlement/runtime response, and uses Acepe's managed Claude install rather than PATH fallback.
- Install-card copy: the reused install/upgrade card explicitly tells the user that Acepe uses its managed Claude install and may ignore `claude` / `claude-code` binaries already present on PATH.

**Verification:**
- `bun run check` in `packages/desktop` passes.
- `bun test` in `packages/desktop` passes.
- `cargo clippy --all-targets --no-default-features -- -D warnings` in `packages/desktop/src-tauri` passes.
- `cargo test --no-default-features -- --skip claude_history::export_types` in `packages/desktop/src-tauri` passes.
- Manual smoke captures the raw `result.modelUsage.<model>.contextWindow` evidence used during the session, not only the rendered UI chip.
- Manual smoke verifies the successful `[1m]` path when an entitled environment is available. If a non-entitled environment is not available, sign-off instead requires targeted automated tests for the one-time entitlement fallback plus the captured terminal evidence proving Claude's explicit rejection shape.
- Manual cold-install / upgrade smoke: with no cached Claude binary present, or with a cached managed Claude binary below the required semver floor, Acepe routes through the same existing install/progress card and then launches Claude without PATH fallback.
- Regression smoke: the same UI flow with Opus still shows `200k`, and the same UI flow with Haiku still shows `200k`.
- `CHANGELOG.md` contains the 1M request behavior, entitlement-fallback note, and managed-install-only Claude runtime note for the release entry being prepared.
- Helper callers in `query.rs` / `sessions.rs` fail with explicit managed-runtime repair errors rather than PATH fallback when the managed Claude binary is missing or below floor.
- Claude provider availability, spawn config resolution, and model discovery no longer fall back to PATH `claude` / `claude-code`; managed install only.
- Live Claude runtime resolution and version enforcement no longer rely on warn-only PATH/common-location discovery; the managed Claude cache plus minimum semver floor define the supported runtime.

---

- [ ] **Follow-up Unit 2: Delete `packages/acps/claude`, release workflow, and remaining dead references** *(separate PR required)*

**Goal:** Remove the `@zed-industries/claude-agent-acp` sidecar codepath in one atomic follow-up commit or PR. Repo no longer contains the package, the release workflow, or the root test-runner tail. The orphan-sweep string can remain for one transition release if needed.

**Requirements:** R4, R5

**Dependencies:** Unit 1

**Files:**
- Delete: `packages/acps/claude/` (recursive — `src/`, `patches/`, `package.json`, `bun.lock`, `package-lock.json`, `README.md`, `CHANGELOG.md`, `tsconfig.json`, `src/tests/`, everything). Leaving the empty `packages/acps/` parent in place is acceptable because its removal is cosmetic only.
- Delete: `.github/workflows/release-claude-acp.yml`
- Modify: `package.json` (root) — remove the trailing `&& bun run --cwd packages/acps/claude test:run` from the `test` script at line 16. Resulting script ends at `packages/website test`.

**Approach:**
- Start with a scoped reference trace: `rg "acps/claude|claude-agent-acp|@zed-industries/claude-agent-acp"` across the repo, excluding `packages/acps/claude/**`, planning/docs artifacts (`docs/plans/**`, `docs/brainstorms/**`, `docs/solutions/**`), lockfiles, and `node_modules`. For each match, classify: (a) inside the package to-be-deleted (ignore), (b) root test runner / release workflow / transition-only orphan sweep, or (c) previously unknown live consumer (STOP and revise before deleting).
- Re-verify that `CommunicationMode::CcSdk` is the only mode used by `ClaudeCodeProvider`, and that `install_claude_cli` downloads the real Claude CLI from Anthropic rather than anything under `packages/acps/claude`.
- Only proceed once Unit 1 is green. If Unit 1 needed broader runtime changes than planned, keep this as a separate follow-up PR instead of widening the rollout diff.
- One commit. Atomic. If the reference trace surfaced nothing unexpected, this is purely deletions + small edits.
- Sanity check after deletion: `bun test`, `bun run --cwd packages/desktop check`, `cargo clippy --all-targets --no-default-features -- -D warnings`, and `cargo test --no-default-features -- --skip claude_history::export_types`. Any failure means a reference was missed — investigate, don't band-aid.

**Execution note:** Single atomic commit. No test-first for deletions — the verification is that `bun test` + `bun run check` + the CI-equivalent Rust checks still pass. Those serve as the regression net.

**Test scenarios:**
- Test expectation: none for the deletions themselves — no behavior change. Regression coverage comes from the existing test suite running clean post-deletion. The relevant implicit assertion is: "every other `packages/*` still builds and tests pass after `packages/acps/claude` is gone."
- Optional sanity smoke (manual): launch a new Claude Code session from the UI after the deletion. First turn completes. Metrics chip populates. This is already covered by Unit 1 and only needs to be repeated here if the cleanup PR touches any runtime-adjacent desktop wiring.

**Verification:**
- If the orphan-sweep string is removed in this follow-up PR, `rg "acps/claude|claude-agent-acp|@zed-industries/claude-agent-acp"` returns zero matches outside the deleted package, planning/docs artifacts, lockfiles, and `node_modules`. If the orphan-sweep string is intentionally retained for one transition release, exclude `packages/desktop/src-tauri/src/lib.rs` from that zero-match gate and record the deferment explicitly in the PR.
- `bun test` from repo root succeeds.
- `bun run check` in `packages/desktop` succeeds.
- `cargo clippy --all-targets --no-default-features -- -D warnings` in `packages/desktop/src-tauri` succeeds.
- `cargo test --no-default-features -- --skip claude_history::export_types` in `packages/desktop/src-tauri` succeeds.
- If the cleanup PR touches runtime-adjacent desktop wiring, repeat the manual end-to-end Claude session smoke and confirm the context chip from Unit 1 still reports the expected million-scale Sonnet budget.
- `.github/workflows/release-claude-acp.yml` no longer exists, and no remaining workflow file references `claude-acp` tags or `packages/acps/claude`.

## System-Wide Impact

- **Interaction graph:** Part 1 touches four surfaces: the Claude runtime model-selection boundary (`build_options()` / `set_model(...)` derive `[1m]` API model IDs from canonical Sonnet IDs), the shared cc-sdk Claude resolver/transport layer (managed-cache-only resolution plus enforced minimum CLI floor), Claude provider runtime selection (`claude_code.rs` removes PATH fallback and standardizes on the managed install), and the existing desktop install-progress surface (`agent-panel.svelte` / `AgentInstallCard`) reused for both first install and upgrade. Two architectural seams are bridged explicitly: (a) version-floor enforcement flows through `is_available()` returning `false` for below-floor binaries, which triggers `client_factory`'s existing auto-install gate rather than requiring the transport layer to hold an `app_handle`; (b) `find_claude_cli()` delegates to `agent_installer::get_cached_binary()` so the five callers in `query.rs`/`sessions.rs` automatically inherit managed-only resolution without call-site changes. Part 2 is pure deletion — no runtime surface changes because the deleted code was already unreferenced.
- **Error propagation:** Part 1 now has four practical failure modes to verify: the managed Claude install may be missing, the managed Claude install may be below the minimum supported floor, Claude may reject `[1m]` because the account lacks extra-usage entitlement, and Claude may still return `200k` even after a valid `[1m]` request. The first two route through the existing managed install/upgrade path and existing card surface on launch paths; helper callers may instead return explicit repairable managed-runtime errors. The explicit entitlement error routes through a one-time fallback to plain Sonnet. The last case is acceptable degraded behavior because Acepe displays only the real returned `modelUsage`. Part 2 could surface a latent consumer if the pre-delete reference trace missed something, which is why Unit 2 starts with that trace before deleting.
- **State lifecycle risks:** Part 1 intentionally keeps Acepe's session/picker model IDs canonical while deriving `[1m]` only on the Claude runtime edge. That split is the main lifecycle risk: a careless implementation could leak `[1m]` into UI state or persisted session state. Part 2 may leave the `orphaned_acp_process_patterns` entry in place for one transition release to clean up stale upgraded-machine processes; no persistent runtime dependency remains on the deleted sidecar package.
- **API surface parity:** No public API surface touched. Internal Claude runtime selection gains an API-model mapping seam, but the rest of Acepe should still reason about canonical model IDs.
- **Integration coverage:** Unit 1's manual smoke tests (live Sonnet success path, live Sonnet entitlement-fallback path if reproducible, and live Opus/Haiku regression path) are the only way to prove the `[1m]` path works end-to-end. Unit-level tests can prove mapping and fallback logic, but cannot prove the Claude service/runtime honors `[1m]` for a given account.
- **Unchanged invariants:** `install_claude_cli`, `CanonicalAgentId::ClaudeCode`, and the whole `claude_code_settings.rs` permission-mode machinery all keep their current behavior. `resolve_claude_spawn_configs` remains, but now resolves only the managed cached Claude install; the Claude CLI install/launch flow is intentionally narrowed, not broadened.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Requesting Sonnet with `[1m]` still fails to produce 1M at runtime. | Unit 1 uses Claude's recognized model-suffix contract rather than ignored beta headers, adds focused mapping/fallback tests, narrows runtime selection to the managed Claude install, and requires live Sonnet plus both Opus and Haiku regression smokes before completion. If Claude still returns `200k`, Acepe displays the real value rather than inventing a parser override. |
| Removing PATH fallback surprises users who relied on a manually installed `claude` binary outside Acepe's managed install flow. | Accepted by product decision. This rollout intentionally standardizes on one Claude runtime so the `[1m]` request behavior is deterministic. The app-managed Claude install path remains the supported way to run Claude in Acepe. |
| Removing PATH fallback leaves Claude unavailable on machines that do not yet have the managed Claude install cached. | Treat this as an explicit rollout condition, not an accidental regression: verify the no-cache state reports Claude as installable but unavailable without panicking, then verify Acepe's existing managed install path restores provider availability, model discovery, and first-session launch without PATH fallback. Release notes should tell users that Claude now depends on Acepe's managed install. |
| A stale managed Claude cache remains below the first version that supports the `[1m]` model-suffix path. | Use a minimum semver floor enforced via `is_available()` in `claude_code.rs`: when the managed binary is below the floor, `is_available()` returns `false` and `client_factory`'s auto-install gate repairs the install before launch. The transport-layer `check_cli_version()` remains as defense-in-depth logging. |
| Claude recognizes `[1m]` but the user's account lacks the required extra-usage entitlement. | Detect the explicit entitlement error and fall back once to plain Sonnet for that launch. Do not hard-fail the session and do not retry-loop. |
| The pre-delete reference trace misses a live consumer of `packages/acps/claude` and the follow-up cleanup breaks something at runtime. | The follow-up unit starts with the scoped trace, then verifies `CommunicationMode::CcSdk`, and finally runs `bun test`, `bun run check`, CI-equivalent Rust checks, and a live Claude session smoke test. Any failure stops the cleanup PR. The package being already structurally unreferenced in `client_factory.rs` makes this risk low but not zero. |
| Cost surprise: 1M context may carry higher token usage or account-level requirements. | Accepted per user decision (always-on, no toggle, no in-product warning). The mitigation is release-note / changelog disclosure and real-value display only. |

## Documentation / Operational Notes

- Release pipeline: the next `v2026.4.x` tag-driven release will run only `.github/workflows/release.yml` — the main Tauri build. The now-deleted `release-claude-acp.yml` was triggered on a separate tag namespace and is not in the critical path for desktop releases. The relevant `CHANGELOG.md` entry should explicitly call out the new 1M request behavior, possible entitlement-based fallback to standard Sonnet, and managed-install-only Claude runtime support so generated GitHub release notes carry the warning automatically.
- The root `README.md` was grepped and has no direct `@zed-industries/claude-agent-acp` references to clean up. Any extra doc cleanup beyond the package/workflow/test-hook removal is follow-up polish, not required for Unit 2 completion.

## Sources & References

- Rust runtime dispatch: `packages/desktop/src-tauri/src/acp/client_factory.rs:40-79`
- Live cc-sdk options builder + runtime model switching: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs:1164-1253`, `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs:1514-1524`, `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs:2518-2520`
- CLI `result` message type with `modelUsage`: `packages/desktop/src-tauri/src/cc_sdk/types.rs:2000-2038`
- Pass-through parser: `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs:780-795`, `packages/desktop/src-tauri/src/acp/parsers/shared_chat.rs:222-301`
- Existing install-progress card: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`, `packages/desktop/src/lib/acp/components/agent-panel/components/agent-install-card.svelte`
- External prior art for `[1m]` model suffix: `pingdotgg/t3code` `packages/shared/src/model.ts`, `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- Dead sidecar package: `packages/acps/claude/`
- Orphaned sweep string: `packages/desktop/src-tauri/src/lib.rs:339-347`
- Root test runner tail: `package.json:16`
- UI display (unchanged, for reference): `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts:179-200`, `packages/desktop/src/lib/acp/components/model-selector.metrics-chip.svelte:35-52`
