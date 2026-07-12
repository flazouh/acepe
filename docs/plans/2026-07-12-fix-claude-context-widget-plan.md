---
title: "fix: Match Claude Code context-window accounting"
date: 2026-07-12
status: reviewed
---

# Goal

Make Acepe's Claude Code context widget show the same live occupancy percentage as Claude Code, including long first turns where no terminal `modelUsage` result has arrived yet.

# Observed failure

For session `e8905a82-30f4-4bb9-a899-68bc75c5c4bf`, Claude Code 2.1.207 selected Fable 5 with a 1,000,000-token window. The assistant usage snapshot around the screenshot contained 189,218 occupied input tokens. Acepe added streamed output tokens, displayed 189,224, had no window size before the turn-terminal result, and rendered the missing percentage as `0%`.

Reverse-engineered Claude Code behavior:

```text
occupied context = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
percentage       = occupied context / model context window
```

`output_tokens` are not part of the occupied input context.

# GOD architecture classification

- Occupied context tokens: `canonical-owned`; normalize in the Rust Claude adapter.
- Context-window size: `canonical-owned`; resolve in the Rust Claude provider adapter.
- Raw Claude model id and aliases: `provider-metadata`; never branch on them in TypeScript.
- Percentage formatting: presentational projection from canonical numerator and denominator.
- The current `null -> 0%` fallback: `must-be-deleted` because it presents missing truth as measured truth.

No dual read, UI provider branch, or frontend repair is allowed.

# Implementation units

## U1 — Provider-owned Claude context-window resolver

Create a small Claude provider module under `acp/providers/claude_code/` that resolves a capability-bearing selected model identity into a context-window size. Use an explicit, dated table for Claude Code aliases/defaults plus an exact `[1m]` modifier rule. Required behavior:

- The configured `fable` selection resolves to `1_000_000`, matching Claude Code 2.1.207's inspected model option. Do not infer this from the stripped assistant wire id.
- Recognized explicit `[1m]` selections resolve to `1_000_000`.
- Known standard Claude model identities resolve to their documented/default window.
- Unknown identities return `None`; never infer from token counts or session totals.

The resolver belongs in the Claude provider home, not the generic parser or frontend. Add focused table tests and a dated maintenance comment recording the inspected Claude Code version/build.

Resolve the effective selection before connection from the explicit pending selection or the existing Claude settings resolver. Emit a context-budget-only `UsageTelemetryUpdate` when the session connects. On a successful runtime `set_model`, emit a new capability event immediately so the old model budget cannot survive the model transition. The assistant wire model remains separate provider metadata and must not erase the capability-bearing selection.

The existing configured-model path preserves literal settings such as `opus[1m]`; this slice does not add new `[1m]` rows to Acepe's curated picker. Fable is resolved from the configured `fable` alias using the dated Claude Code capability table. Picker expansion is a separate model-catalog concern, not required to fix the observed configured Fable session.

Add `context_window_source` to canonical `UsageTelemetryData`, using the existing frontend vocabulary (`provider-explicit`, `provider-model-capability`, `catalog-fallback`, `unknown`). The reducer must preserve provenance:

- a capability event is dispatched synchronously before the streaming bridge begins consuming messages, so it establishes the budget on fresh connect/reconnect;
- a successful model change is only accepted between turns; its capability event replaces the old model budget before the next turn starts;
- `usage_update.size` and Result `modelUsage.contextWindow` replace a capability value as `provider-explicit`;
- ordinary assistant occupancy events carry no session budget and therefore cannot overwrite either source;
- telemetry with `parent_tool_use_id` is excluded from the top-level session widget projection. This slice does not introduce the separate lineage-keyed sub-agent telemetry model planned elsewhere.

These lifecycle ordering rules prevent a same-model reconnect from downgrading a persisted explicit budget because usage telemetry is transient and reconstructed on reconnect. They also prevent late old-model Result events because model mutation is not accepted during an active turn. Add tests at these command boundaries instead of introducing a speculative model-generation protocol.

## U2 — Canonical live occupancy semantics

At the assistant-usage translation seam in `acp/parsers/cc_sdk_bridge.rs`:

- Compute `tokens.total` as input + cache-read + cache-creation.
- Keep output tokens in `tokens.output` for telemetry, but exclude them from occupancy.
- Keep top-level assistant events occupancy-only; the session connection/model-change boundary emits the provider-model-capability budget before the terminal Result message.
- Preserve the existing provider-explicit `usage_update.size` and Result `modelUsage.contextWindow` paths as higher-authority explicit facts.
- Ensure sub-agent telemetry cannot change the top-level session numerator or denominator; a future lineage widget owns separate sub-agent budget resolution.

TDD seams:

- `translate_cc_sdk_message_with_turn_state`, exercised with a real-shaped Fable assistant usage payload, proves `occupied = 189_218`, output remains separately recorded, and the event does not invent a session budget;
- `cc_sdk_client` connection/streaming behavior proves a configured Fable selection emits a 1,000,000-token capability before the first assistant event;
- reducer sequence tests prove capability -> explicit -> later occupancy retains the explicit value, and an explicit old-model budget -> model-change capability replaces it;
- reducer routing tests prove `parent_tool_use_id` telemetry cannot mutate the top-level session widget.

## U3 — Honest unknown-state presentation

In `model-selector.metrics-chip.svelte`, stop substituting `0` when `getContextUsagePercent` returns `null`. Extend the presentational `AgentInputMetricsChip` with an explicit unknown state that renders `—`, remains an accessible tooltip trigger, and never emits a zero-valued percentage label. Keep the tooltip's existing token-only fallback.

Add rendered component regressions proving missing context capacity renders `—` plus the token-only tooltip without `0%`, while a Fable-shaped canonical snapshot renders approximately `19%`.

# Files expected to change

- `packages/desktop/src-tauri/src/acp/providers/claude_code/mod.rs`
- new focused module under `packages/desktop/src-tauri/src/acp/providers/claude_code/`
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs`
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/streaming_bridge.rs` only if the connection-level capability event cannot be emitted before spawning the bridge
- `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs`
- `packages/desktop/src-tauri/src/acp/session_update/types/interaction.rs`
- generated `packages/desktop/src/lib/services/acp-types.ts`
- Rust tests colocated with those modules
- `packages/desktop/src/lib/acp/store/envelope-reducer/canonical-usage-telemetry.ts`
- reducer sequence tests
- `packages/desktop/src/lib/acp/components/model-selector.metrics-chip.svelte`
- `packages/ui/src/components/agent-panel/agent-input-metrics-chip.svelte`
- focused widget tests under `packages/desktop/src/lib/acp/components/__tests__/`

# Verification

1. Red/green focused Rust tests for Fable occupancy and window resolution.
2. Focused Bun component/logic tests.
3. `cargo fmt --check` and focused Rust tests.
4. Regenerate/verify Specta bindings for `UsageTelemetryData`, then run `bun run check` after TypeScript/Svelte changes.
5. `bun run test:rust:fast` and relevant Bun test suite.
6. `cargo clippy` for the Rust package.
7. Code review; resolve all actionable findings.
8. Real Tauri QA after the change:
   - `bun run qa doctor`
   - identify the exact Claude Code panel/session
   - inspect the context-widget DOM inside that panel
   - verify the live meter is non-zero and the tooltip includes used/window values
   - capture a screenshot showing Claude identity and the widget together

# Success criteria

- A Fable assistant snapshot with 189,218 input-context tokens produces a 1,000,000-token context budget and about 19% usage before turn completion.
- Output streaming does not increase occupied context.
- Explicit provider budgets cannot be overwritten by later occupancy events.
- A runtime model change replaces the previous model's budget before new usage arrives.
- Standard, configured explicit 1M, Fable alias, unknown, and sub-agent-exclusion cases are covered by table/sequence tests.
- Missing capacity remains visible as `—` with token details, never `0%`.
- No Claude-specific model logic is added to TypeScript or `packages/ui`.
