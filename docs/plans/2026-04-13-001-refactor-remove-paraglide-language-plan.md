---
title: refactor: Remove Paraglide and language settings
type: refactor
status: active
date: 2026-04-13
---

# refactor: Remove Paraglide and language settings

## Overview

Remove Paraglide, generated translation catalogs, and UI locale switching from both `packages/desktop` and `packages/website`, leaving Acepe as an English-only product. The refactor must also remove locale-aware website routing/SEO behavior, desktop locale persistence/bootstrap, and the repo tooling/CI/docs that currently assume generated Paraglide artifacts exist.

## Problem Frame

The repo currently carries two different i18n shapes:

- `packages/desktop` uses Paraglide as a general string layer and persists a user-selected UI locale in app settings.
- `packages/website` uses Paraglide for both copy and locale-aware routing/SEO (`/es/...`, canonical/hreflang generation, sitemap expansion, and `%paraglide.lang%` injection).

The requested direction is to remove Paraglide from the whole repo and remove language settings as product behavior. That means the refactor is not only a dependency cleanup; it also changes user-visible behavior and external website surfaces. The plan therefore treats this as a deep, cross-package refactor rather than a package.json-only removal.

## Requirements Trace

- R1. No package in the repo depends on or generates Paraglide/i18n artifacts.
- R2. Desktop no longer exposes a UI language selector, system-locale bootstrap, or persisted `user_locale` setting.
- R3. Website becomes single-language English, with no locale-aware content routing, no locale switcher plumbing, and no locale-expanded sitemap/canonical/hreflang behavior.
- R4. Existing user-visible desktop and website surfaces continue to render correct English copy after replacing `m.*()` usage.
- R5. CI, docs, ignores, and tests stop assuming generated Paraglide output exists.

## Scope Boundaries

- Removing Paraglide and UI locale/language settings is in scope.
- Replacing localized copy with a new generalized copy-management framework is out of scope; use plain English strings or narrowly scoped local constants where reuse is needed.
- Rewriting unrelated settings surfaces is out of scope.

### Deferred to Separate Tasks

- Voice transcription language (`voice_language`) remains unchanged. It is a speech-model/runtime setting, not UI locale, and should be handled only if product explicitly requests its removal in a separate task.

## Context & Research

### Relevant Code and Patterns

- Desktop locale bootstrap and rerender gate live in `packages/desktop/src/routes/+layout.svelte`.
- Desktop locale state/persistence live in `packages/desktop/src/lib/i18n/store.svelte.ts` and `packages/desktop/src/lib/i18n/locale.ts`.
- Desktop language selection UI currently lives in `packages/desktop/src/lib/components/settings-page/sections/general-section.svelte`, with additional legacy/stale assumptions visible in `packages/desktop/src/lib/components/settings-page/settings-sidebar.svelte.vitest.ts`.
- Website locale routing and SSR lang injection live in `packages/website/src/hooks.server.ts`, `packages/website/src/hooks.ts`, `packages/website/src/app.html`, and `packages/website/src/routes/+layout.svelte`.
- Website locale-aware SEO lives in `packages/website/src/lib/components/seo/canonical.svelte`, `packages/website/src/lib/components/seo/hreflang.svelte`, `packages/website/src/lib/components/seo/json-ld.svelte`, and `packages/website/src/routes/sitemap.xml/+server.ts`.
- Repo tooling still assumes generated artifacts exist in `packages/desktop/package.json`, `packages/website/package.json`, `packages/desktop/vite.config.js`, `packages/website/vite.config.ts`, and `.github/workflows/ci.yml`.

### Institutional Learnings

- No prior `docs/solutions/` entry directly covers Paraglide or locale removal, so the plan should stay grounded in current repo structure rather than inferred historical practice.
- `AGENTS.md` requires a non-trivial refactor to go through plan → review → work, and implementation should stay test-first for behavior-bearing changes.

### External References

- None. Local repo patterns are sufficient because the task is a repo-specific removal, not a new external integration.

## Key Technical Decisions

- **Collapse to English-only behavior directly:** Remove locale routing, locale persistence, and locale selection outright instead of preserving a dormant abstraction. This matches the requested “remove it from the whole repo” scope.
- **Do not replace Paraglide with a new global string service:** Use inline English copy or small local copy constants per feature cluster so the refactor does not recreate a second abstraction layer.
- **Treat website locale URLs as an external contract surface:** Remove locale-aware generation, but preserve inbound localized URL compatibility with explicit redirects to canonical English paths so existing links and indexing do not silently break.
- **Treat stored desktop `user_locale` values as inert legacy data:** Remove read/write paths and the enum key from typed surfaces rather than inventing a storage migration for a key-value setting that will no longer be consumed.
- **Keep voice transcription language out of scope:** It is a different product setting and shares the word “language” only incidentally.

## Open Questions

### Resolved During Planning

- **What is the replacement locale?** English becomes the only supported UI/site language.
- **Should old localized website paths survive?** Yes — redirect locale-prefixed paths to the canonical English route rather than 404ing them.
- **Do we need a storage migration for desktop locale settings?** No schema migration is required; removing the typed key and all read/write paths is sufficient because stale values become unused.

### Deferred to Implementation

- **Where should repeated English copy live after `m.*()` removal?** The implementing agent should decide per cluster whether a shared local constant improves clarity; do not force a new repo-wide copy abstraction.
- **Which copy-heavy desktop tests should be rewritten versus simplified?** This depends on the smallest stable assertion surface once message mocks disappear.

## Implementation Units

- [ ] **Unit 1: Collapse desktop locale runtime to fixed English**

**Goal:** Remove the desktop runtime/bootstrap dependency on Paraglide locale state so the app renders against a fixed English copy baseline.

**Requirements:** R1, R2, R4

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/routes/+layout.svelte`
- Modify: `packages/desktop/src/lib/i18n/store.svelte.ts`
- Modify: `packages/desktop/src/lib/i18n/locale.ts`
- Modify: `packages/desktop/src/lib/i18n/utils.ts`
- Modify: `packages/desktop/src/lib/acp/**/*.{svelte,ts}` (all remaining `$lib/paraglide/messages.js` call sites in ACP surfaces)
- Modify: `packages/desktop/src/lib/components/**/*.{svelte,ts}` (all remaining `$lib/paraglide/messages.js` call sites in shared desktop UI)
- Modify: `packages/desktop/src/lib/services/converted-session-types.ts`
- Test: `packages/desktop/src/lib/components/settings-page/settings-sidebar.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/tool-call-read.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/tool-call-task.svelte.vitest.ts`

**Approach:**
- Remove the locale rerender keying in `+layout.svelte` and stop bootstrapping persisted/system locale on mount.
- Delete or inline the desktop i18n store/locale helpers so callers no longer depend on `setLocale`, `getLocale`, or supported-language metadata.
- Replace `m.*()` usage with English strings or local copy constants in each feature cluster.
- Update copy-sensitive tests to assert rendered English output or structural behavior instead of mocking Paraglide modules.

**Execution note:** Start with characterization coverage around desktop settings/sidebar and a representative copy-heavy test seam before deleting locale bootstrap.

**Patterns to follow:**
- Existing plain-English settings copy already present in `packages/desktop/src/lib/components/settings-page/sections/general-section.svelte`
- Existing non-i18n ACP labels in components that do not import Paraglide today

**Test scenarios:**
- Happy path — desktop root layout renders without locale initialization and still mounts shared providers/toaster/error boundary correctly.
- Happy path — representative ACP/tool-call components render English labels without importing or mocking `$lib/paraglide/messages.js`.
- Edge case — tests that previously depended on locale-driven rerendering still pass when the language is fixed.
- Error path — no desktop startup path attempts to call missing locale helpers or Tauri locale commands.
- Integration — settings navigation and one representative main-app screen render correctly after the shared message layer is removed.

**Verification:**
- Desktop no longer imports Paraglide runtime/messages for UI rendering, and representative component tests prove English rendering still works.

- [ ] **Unit 2: Remove desktop language settings and persistence**

**Goal:** Delete the user-facing language selector and the backend persistence/command surfaces that only exist to support UI locale switching.

**Requirements:** R1, R2, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/components/settings-page/sections/general-section.svelte`
- Modify: `packages/desktop/src/lib/components/settings/language-tab.svelte`
- Modify: `packages/desktop/src/lib/i18n/components/language-selector.svelte`
- Modify: `packages/desktop/src/lib/services/converted-session-types.ts`
- Modify: `packages/desktop/src-tauri/src/commands/locale.rs`
- Modify: `packages/desktop/src-tauri/src/lib.rs`
- Modify: `packages/desktop/src-tauri/src/storage/types.rs`
- Modify: `packages/desktop/src-tauri/src/commands/names.rs`
- Modify: `packages/desktop/src/lib/utils/tauri-client/commands.ts`
- Modify: `packages/desktop/src/lib/utils/tauri-client/shell.ts`
- Test: `packages/desktop/src/lib/components/settings-page/settings-sidebar.svelte.vitest.ts`
- Test: `packages/desktop/src-tauri/src/storage/types.rs`

**Approach:**
- Remove the language picker from general settings and fold its descriptive copy back to theme/appearance-only wording.
- Delete no-longer-used desktop language UI wrappers rather than leaving dead components behind.
- Remove `UserLocale` from typed storage keys and unregister `get_system_locale` if nothing else consumes it.
- Regenerate any TS/Rust command-name/type surfaces that encode the removed locale command/setting key.

**Execution note:** Add or update tests first to assert that the desktop settings sidebar/general settings no longer expose a language section or `language` destination.

**Patterns to follow:**
- Theme-only settings controls in `packages/desktop/src/lib/components/settings-page/sections/general-section.svelte`
- Existing Tauri command registration patterns in `packages/desktop/src-tauri/src/lib.rs`

**Test scenarios:**
- Happy path — general settings renders theme controls and notification controls without a language selector.
- Happy path — settings sidebar no longer exposes a “Language” navigation target.
- Edge case — old persisted `user_locale` values in storage do not affect app startup because no consumer reads them.
- Error path — Tauri command registration remains valid after removing `get_system_locale`.
- Integration — typed user-setting surfaces no longer include `user_locale`, and generated TypeScript bindings remain aligned with Rust enums/commands.

**Verification:**
- Desktop settings show no UI language controls, and no backend/user-setting type surface references `user_locale` or `get_system_locale`.

- [ ] **Unit 3: Collapse website locale routing and SEO to single-language behavior**

**Goal:** Remove locale-aware website middleware and SEO generation while preserving canonical English routing behavior.

**Requirements:** R1, R3, R5

**Dependencies:** None

**Files:**
- Modify: `packages/website/src/hooks.server.ts`
- Modify: `packages/website/src/hooks.ts`
- Modify: `packages/website/src/app.html`
- Modify: `packages/website/src/routes/+layout.svelte`
- Modify: `packages/website/src/lib/components/seo/canonical.svelte`
- Modify: `packages/website/src/lib/components/seo/hreflang.svelte`
- Modify: `packages/website/src/lib/components/seo/json-ld.svelte`
- Modify: `packages/website/src/routes/sitemap.xml/+server.ts`
- Test: `packages/website/src/hooks.test.ts`
- Test: `packages/website/src/hooks.server.test.ts`
- Test: `packages/website/src/routes/sitemap.xml/server.test.ts`

**Approach:**
- Remove Paraglide middleware/runtime hooks and hardcode `<html lang="en">`.
- Replace locale-aware canonical/json-ld logic with single-language equivalents.
- Remove hreflang alternate generation entirely.
- Stop expanding sitemap entries by locale and add redirect handling for locale-prefixed paths to their English canonical equivalents.

**Execution note:** Start with characterization coverage for sitemap/canonical behavior and locale-prefixed URL handling before deleting locale middleware.

**Patterns to follow:**
- Existing server hook sequencing in `packages/website/src/hooks.server.ts`
- Existing route/server test style in `packages/website/src/routes/sitemap.xml/server.test.ts`

**Test scenarios:**
- Happy path — canonical URLs and JSON-LD emit English-only URLs for non-prefixed routes.
- Happy path — sitemap outputs one entry per route instead of one entry per locale.
- Edge case — `/es`, `/es/`, and `/es/<path>` redirect to the corresponding English canonical route.
- Error path — removing locale middleware does not interfere with bot filtering, CORS handling, or migration startup logic.
- Integration — root layout and SEO components render correctly with `<html lang="en">` and without alternate-language tags.

**Verification:**
- Website routing and SEO no longer depend on locale runtime state, and tests cover canonical routing plus localized URL redirects.

- [ ] **Unit 4: Replace website Paraglide message usage with English copy**

**Goal:** Remove message-catalog usage from website pages/components without changing the visible English content.

**Requirements:** R1, R3, R4

**Dependencies:** Unit 3

**Files:**
- Modify: `packages/website/src/routes/+page.svelte`
- Modify: `packages/website/src/routes/blog/+page.svelte`
- Modify: `packages/website/src/routes/changelog/+page.svelte`
- Modify: `packages/website/src/routes/compare/+page.svelte`
- Modify: `packages/website/src/routes/compare/[slug]/+page.svelte`
- Modify: `packages/website/src/routes/download/+page.svelte`
- Modify: `packages/website/src/routes/login/+page.svelte`
- Modify: `packages/website/src/routes/pricing/+page.svelte`
- Modify: `packages/website/src/lib/components/header.svelte`
- Modify: `packages/website/src/lib/components/app-name.svelte`
- Modify: `packages/website/src/lib/blog/blog-post-layout.svelte`
- Test: `packages/website/src/routes/compare/[slug]/page.test.ts`
- Test: `packages/website/src/routes/pitch/page.test.ts`

**Approach:**
- Replace `m.*()` calls with English literals or small local constant maps near the page/component that owns the copy.
- Delete the hidden locale-link block from the root layout once locale routing is gone.
- Keep the visible English wording aligned with the existing English catalog rather than opportunistically rewriting marketing copy during this refactor.

**Patterns to follow:**
- Existing website components already using direct English copy
- Current English wording in `packages/website/messages/en.json`

**Test scenarios:**
- Happy path — key marketing and logged-out pages still render expected English headings/CTA text after message imports are removed.
- Edge case — components previously deriving labels from runtime locale continue to render stable English output during SSR and client hydration.
- Error path — pages do not import deleted Paraglide modules after the replacement.
- Integration — route tests still pass with direct copy and the root layout no longer emits hidden locale links.

**Verification:**
- Website pages/components render the same English copy without `m.*()` imports or message catalogs.

- [ ] **Unit 5: Remove repo-wide Paraglide tooling, generated artifacts, and i18n docs**

**Goal:** Delete the remaining build/CI/doc assumptions that Paraglide or UI locale configuration still exists anywhere in the repo, while leaving unrelated runtime settings such as `voice_language` untouched.

**Requirements:** R1, R5

**Dependencies:** Units 1, 2, 3, 4

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `bun.lock`
- Modify: `packages/desktop/package.json`
- Modify: `packages/website/package.json`
- Modify: `packages/desktop/inlang.config.js`
- Modify: `packages/desktop/vite.config.js`
- Modify: `packages/website/vite.config.ts`
- Modify: `packages/desktop/biome.json`
- Modify: `packages/website/biome.json`
- Modify: `packages/desktop/tsconfig.json`
- Modify: `packages/desktop/tsconfig.fast.json`
- Modify: `packages/desktop/tsconfig.svelte-check.json`
- Delete: `packages/desktop/project.inlang/`
- Delete: `packages/website/project.inlang/`
- Delete: `packages/desktop/messages/`
- Delete: `packages/website/messages/`
- Delete: `packages/desktop/src/paraglide/`
- Delete: `packages/website/src/lib/paraglide/`
- Modify: `.agent-guides/i18n.md`
- Modify: `docs/superpowers/specs/2026-03-27-paraglide-generation-contract-design.md`
- Modify: `packages/desktop/scripts/i18n/README.md`

**Approach:**
- Remove Paraglide dependencies, generate/translate scripts, Vite plugin wiring, generated-code ignore rules, and CI generation steps.
- Delete generated/source translation directories only after all call sites are gone.
- Update repo guidance to stop telling contributors to generate or use Paraglide.
- Preserve historical documentation only if needed for changelog/history context; otherwise replace it with an explicit note that the contract has been retired.

**Patterns to follow:**
- Existing CI parallelization/layout in `.github/workflows/ci.yml`
- Existing package-specific tooling configuration patterns in both app packages

**Test scenarios:**
- Happy path — package install, check, and test workflows run without any `i18n:generate` prerequisite.
- Edge case — deleting generated Paraglide directories does not leave stale ignore/config references behind.
- Error path — Vite, Biome, and TypeScript config load successfully after Paraglide plugin removal.
- Integration — CI frontend job validates both packages without a generation step.

**Verification:**
- No repo config, docs, or package manifest references Paraglide/inlang, and no generated locale artifacts remain in tracked source paths.

## System-Wide Impact

- **Interaction graph:** Desktop startup loses locale bootstrap before highlighter/markdown initialization; website request handling loses locale middleware but retains CORS, bot filtering, and migration startup.
- **Error propagation:** Removal should reduce failure modes by eliminating locale bootstrap and generated-artifact dependencies; new redirect logic must fail closed to canonical English routes, not mixed locale states.
- **State lifecycle risks:** Stale desktop `user_locale` values will remain in key-value storage unless explicitly pruned, but they must become inert and unreachable.
- **API surface parity:** Website locale-prefixed URLs and sitemap output are external surfaces; desktop typed settings/command surfaces are internal shared contracts that must stay aligned after removal.
- **Integration coverage:** Unit tests alone are not enough for website SEO/routing — sitemap generation and locale-prefix redirects need route/server coverage, and desktop settings removal needs at least one integration-style UI test proving the old language path is gone.
- **Unchanged invariants:** Theme selection, notification settings, voice transcription language, and other non-locale settings must behave exactly as before.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Locale-prefixed website URLs break external links or SEO expectations | Add explicit redirect coverage for `/es`-prefixed paths before removing locale middleware and sitemap expansion |
| Desktop copy removal creates broad test churn | Start with representative characterization tests and move assertions to stable rendered English output rather than message mocks |
| “Language settings” scope accidentally swallows voice transcription controls | Treat `voice_language` as explicitly out of scope throughout implementation and review |
| Tooling cleanup leaves hidden generation assumptions in CI/config | Finish with a dedicated tooling/docs unit and require package checks/tests to run without `i18n:generate` |

## Phased Delivery

### Phase 1

Collapse desktop locale runtime and remove desktop language settings/persistence (Units 1-2).

### Phase 2

Collapse website locale routing/SEO and replace website Paraglide message usage with English copy (Units 3-4).

### Phase 3

Remove remaining Paraglide tooling, generated artifacts, and contributor guidance after both app surfaces are clean (Unit 5).

## Documentation / Operational Notes

- Update contributor guidance so new work does not reintroduce Paraglide or assume generated translation output.
- Note the retirement of localized website URLs and the canonical redirect behavior in release notes or changelog if this lands in a user-visible release.
- Expect a large but mechanical diff across Svelte/TS files; review should focus on parity, deleted locale surfaces, and SEO correctness rather than copy rewrites.

## Sources & References

- Related code: `packages/desktop/src/routes/+layout.svelte`
- Related code: `packages/desktop/src/lib/i18n/store.svelte.ts`
- Related code: `packages/desktop/src/lib/components/settings-page/sections/general-section.svelte`
- Related code: `packages/website/src/hooks.server.ts`
- Related code: `packages/website/src/routes/+layout.svelte`
- Related code: `packages/website/src/lib/components/seo/canonical.svelte`
- Related code: `packages/website/src/routes/sitemap.xml/+server.ts`
- Related doc: `.agent-guides/i18n.md`
- Related doc: `docs/superpowers/specs/2026-03-27-paraglide-generation-contract-design.md`
