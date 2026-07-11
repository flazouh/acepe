# OpenCode provider-first model picker

## Goal

Make large OpenCode catalogs calm and useful: users choose an upstream provider first, see only that provider's models, and see a verified upstream mark (or a neutral fallback) instead of the incorrect OpenCode agent logo.

## Architecture

- Rust remains the authority for model/provider identity.
- Widen `DisplayModelGroup` with `providerId`, `providerLabel`, and a separate `UpstreamProviderBrand` derived from `AvailableModel.provider.provider_id`. Do not widen or reuse the agent-level `ProviderBrand` union.
- TypeScript maps canonical group metadata into the shared picker contract without provider-specific branches.
- `@acepe/ui` owns only local picker state: active provider, search query, and rendering.
- Do not infer provider identity from group labels or model IDs in the UI.

## Implementation

1. Add provider identity and presentation brand to Rust display groups. Map known upstream providers centrally (`github-copilot`, `openrouter`, `anthropic`, and fallback/custom) through a new `UpstreamProviderBrand` enum and export generated TypeScript types.
2. Extend the shared mark contract for upstream brands with verified OpenRouter and GitHub Copilot identities/assets. Reuse the existing local Copilot asset. Vendor a theme-safe OpenRouter mark from OpenRouter's official website/brand surface into the local static asset tree; do not use a remote runtime URL. Unknown providers receive a neutral initial mark, never the OpenCode logo.
3. Preserve per-group provider metadata in `model-selector.svelte`; stop stamping every group/item with the outer OpenCode agent brand.
4. Add a compact provider rail to the standard model selector when two or more provider groups exist. Resolve active provider with one pure rule whenever inputs change: keep the active provider if still present; otherwise use the selected model's provider; otherwise use the remembered provider for this agent if present; otherwise use the first non-empty group; otherwise `null`. Persist the last provider per agent in the existing desktop preferences layer; `packages/ui` receives it through props and stays storage-free.
5. Switching provider clears the search query and shows only that provider's models. Search and favorites are both strictly scoped to the active provider; favorites from other providers reappear only after switching provider. Preserve canonical group order.
6. Use an accessible horizontally scrollable tablist for the provider rail at narrow widths. Tabs have provider names as accessible labels, left/right arrows move and activate adjacent providers, Tab moves into search/model rows, and the active tab remains scrolled into view. Loading keeps the trigger disabled; empty catalogs use the existing empty state; a provider/search with no matches renders `No models from {provider}` or `No matching models from {provider}` respectively.
7. The trigger displays the selected model's upstream provider mark. The outer agent identity remains OpenCode elsewhere in the composer/session UI.

## TDD seams

- Rust `DefaultTransformer`: explicit provider catalogs produce groups with exact provider IDs/brands.
- Shared picker state: active-provider resolution, stale-provider recovery, provider-scoped search, and provider-scoped favorites are pure and deterministic.
- Shared Svelte picker DOM: provider controls render, switching controls changes visible model rows, and selected upstream mark is used.
- Desktop adapter: canonical group provider metadata reaches `@acepe/ui` unchanged.

## Verification

- Focused Rust model-display/export tests.
- Focused shared picker state and DOM tests.
- `bun run check` and relevant frontend tests.
- Real dev Tauri QA: open an OpenCode new-chat model picker, inspect provider controls and marks, switch to OpenRouter, prove every non-OpenRouter model disappears, select an OpenRouter model, reopen the picker to prove the provider preference is remembered, and capture a screenshot at normal and narrow panel widths.

## Constraints

- No provider-label parsing or model-ID parsing in TypeScript.
- No Tauri/store imports in `packages/ui`.
- No `$effect`.
- Preserve keyboard navigation and search.
- Do not change provider request semantics or session model persistence.
