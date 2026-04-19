---
date: 2026-04-19
topic: unified-agent-runtime-resolution
---

# Unified Agent Runtime Resolution

## Problem Frame

Acepe currently resolves agent runtime configuration in multiple places: shell env capture in `packages/desktop/src-tauri/src/shell_env.rs`, provider launch defaults in `packages/desktop/src-tauri/src/acp/providers/*.rs`, generic spawn logic in `packages/desktop/src-tauri/src/acp/client/lifecycle.rs`, and Codex-specific behavior in `packages/desktop/src-tauri/src/acp/client/codex_native_client.rs` and `packages/desktop/src-tauri/src/acp/client/codex_native_config.rs`.

That split ownership creates hidden precedence rules, agent-specific bypasses, and poor observability. Users cannot reliably answer simple questions like "which model/provider/env did Acepe actually launch?" or "why did this agent ignore my override?". The result is fragile launches, hard-to-debug configuration bugs, and provider-specific drift that fights Acepe's agent-agnostic product direction.

## Requirements

**Unified resolution model**
- R1. Acepe must resolve agent runtime configuration through a single shared runtime-resolution pipeline used by every launch path, including native Codex, generic ACP clients, downloaded agents, and future providers.
- R2. The runtime-resolution pipeline must produce one explicit `EffectiveRuntime` object before spawn. At minimum it must cover resolved model selection, provider selection, config source summaries, launch environment, working directory, launch metadata for UI and diagnostics, and explicit provenance for any field that was transformed, overridden, or normalized by Acepe.
- R3. Provider-specific logic must be confined to provider adapters that declare inputs and translation rules, not hidden inside ad hoc spawn paths or client-specific startup code. Provider adapters may derive agent-specific protocol payloads from `EffectiveRuntime`, but they may not re-introduce independent precedence or hidden config resolution after the shared pipeline.

**Explicit precedence and ownership**
- R4. Acepe must define and enforce one documented precedence chain for runtime resolution across defaults, config files, shell-derived environment and existing local/secure storage, saved agent overrides, and explicit session-local or launch-time overrides when present.
- R5. The precedence chain must be visible in the product through the runtime inspector and visible in the codebase as a first-class contract, not an implicit side effect of merge order or process inheritance behavior.
- R6. Field ownership must be explicit. Acepe owns cross-provider launch fields such as effective provider choice, effective model identifier as launched, environment precedence, config-source precedence, working directory, and launch arguments. Provider adapters own only the final translation from `EffectiveRuntime` into agent-specific payloads or protocol messages. Acepe must not partially override a field it has delegated, and adapters must not independently resolve a field Acepe has already claimed.

**Deterministic launches**
- R7. Agent subprocesses must launch from the explicit resolved runtime object rather than a mix of inherited process state plus partial overrides.
- R8. Two launches with the same resolved runtime inputs must yield the same effective runtime configuration regardless of startup timing or whether the code path is generic or provider-specific. Binary availability and download state are explicit preconditions surfaced by the resolver rather than hidden inputs.
- R9. Runtime resolution must not rely exclusively on shell-specific side effects for essential credentials or provider selection. Shell-derived environment remains a supported input tier, but Acepe must make its use explicit, inspectable, and overridable within the documented precedence chain.

**Observability and reviewability**
- R10. Acepe must expose an inspectable effective runtime view per session in a launch diagnostics surface that is reachable both from the session UI and directly from launch/failure states. The view must show the resolved model, provider, config sources, override sources, and the presence state of required credentials without leaking secret values.
- R11. When runtime resolution changes a value due to precedence, normalization, or provider translation, Acepe must preserve provenance so the UI and logs can show where the final value came from.
- R12. When a launch fails because required runtime inputs are missing or contradictory, Acepe must surface the missing requirement and its source context directly instead of leaving the user to infer it from downstream agent failures.

**Architecture fit**
- R13. All providers must resolve runtime through the shared pipeline. Provider-specific logic must be confined to adapters after shared resolution, with no provider bypassing the shared runtime contract.
- R14. The architecture must support future providers without requiring each new provider to re-implement env merging, config precedence, or runtime diagnostics.
- R15. The architecture must support secure handling of sensitive values while still allowing users to understand whether a secret was expected, present, overridden, or missing.

## Visual Aid

```text
Inputs
  -> defaults
  -> config files
  -> shell-derived env / secure stored values
  -> saved agent overrides
  -> session overrides
  -> explicit launch overrides

Shared runtime resolver
  -> EffectiveRuntime
     - model
     - provider
     - config source summary
     - launch env
     - launch args
     - working directory
     - provenance
     - diagnostics

Provider adapter
  -> agent-specific spawn contract / protocol payload

Launcher
  -> deterministic subprocess start

UI / logs
  -> effective runtime inspector
```

## Success Criteria
- Acepe has one shared runtime-resolution pipeline for all agent launches, with no provider-specific bypasses for config/env merging.
- A user can inspect a session and see the effective model, provider, config sources, and credential presence state without reading code or raw logs.
- When a saved override, config file value, or shell-derived value loses to a higher-precedence source, Acepe shows the winning source and the losing source in the runtime inspector or linked launch diagnostics.
- Provider/config bugs of the "why didn't my override apply?" class become directly diagnosable from Acepe's own runtime inspector.
- Adding a new provider requires only adapter-specific translation logic on top of the shared runtime contract.

## Scope Boundaries
- This work does not require redesigning unrelated session history, prompt composition, or tool-call rendering flows.
- This work does not require inventing a new secrets product if existing secure/local storage is sufficient for the runtime contract.
- This work does not require exposing raw secret values in UI, logs, or persisted artifacts.
- This work does not require eliminating shell-derived credentials as a supported input source.
- This work does not require a generic manifest/spec system for arbitrary downloaded-agent config schemas in this iteration.

## Key Decisions
- Shared runtime object: Acepe should own a first-class effective runtime model instead of scattering resolution across provider launch paths.
- Adapter-at-the-edge design: Provider-specific quirks belong in adapters after shared resolution, not in launch orchestration.
- Codex boundary: native Codex keeps its transport/session protocol implementation, but its pre-spawn configuration and launch inputs are resolved through the shared pipeline rather than a parallel launch path.
- Deterministic launch contract: subprocesses should launch from explicit resolved inputs rather than ambient process inheritance.
- Inspectability as a product requirement: runtime provenance and diagnostics are part of the feature, not optional tooling.
- All-agents scope: solve this once for the launch architecture rather than creating a Codex-only "better path" that future providers would bypass again.
- Alternatives not taken: a Codex-only fix and launch-time logging-only approach were considered insufficient because they do not establish a durable shared contract for future providers or make precedence inspectable in-product.

## Dependencies / Assumptions
- Existing runtime/config touchpoints in `packages/desktop/src-tauri/src/shell_env.rs`, `packages/desktop/src-tauri/src/acp/providers/*.rs`, `packages/desktop/src-tauri/src/acp/client/lifecycle.rs`, `packages/desktop/src-tauri/src/acp/client/codex_native_client.rs`, and the settings UI provide the current behavior that planning will need to consolidate.
- Acepe can continue using repo-local and user-home config files where appropriate, but their role in precedence must become explicit.
- Downloaded agents participate through a generic passthrough adapter in this requirements slice; richer downloaded-agent manifests or schema discovery are follow-on concerns.

## Outstanding Questions

### Resolve Before Planning
- None.

### Deferred to Planning
- [Affects R2, R3][Technical] What is the minimum viable `EffectiveRuntime` shape that works for native and HTTP-launched agents while keeping provider-specific payload construction inside adapters?
- [Affects R4, R15][Technical] Which existing local or secure storage mechanisms should be elevated as first-class runtime inputs alongside shell-derived environment?
- [Affects R8, R12][Technical] How should the resolver surface missing managed binaries or uncached installs: fail early with diagnostics, trigger acquisition before launch, or hand off to installer flow?
- [Affects R10, R11][Technical] Which runtime inspector data should persist after session end versus remain in-memory during the active session?

## Next Steps

-> /ce:plan for structured implementation planning
