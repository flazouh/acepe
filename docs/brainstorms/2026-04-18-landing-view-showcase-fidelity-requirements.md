# Landing View Showcase — Pixel-Perfect Fidelity

**Status:** Requirements
**Date:** 2026-04-18
**Scope:** Standard

## Problem

The landing page at `packages/website/src/routes/+page.svelte` has a "view showcase" section (rendered by `packages/website/src/lib/components/feature-showcase.svelte`) that advertises Acepe's four workspace layouts:

- **Side by Side** — `agent-panel-demo.svelte`
- **By Project** — `landing-by-project-demo.svelte`
- **Single Agent** — `landing-single-demo.svelte`
- **Kanban** — `landing-kanban-demo.svelte`

Today each demo is hand-built in the website package with mock markup that is "almost similar" to the real app but not identical. Visible drift, confirmed by the user:

- **By Project** — sidebar is wrong: project rows, history affordances, and bottom-left icon strip (GitHub / X / Discord / version) are missing or off-design.
- **Single Agent** — "everything is off"; the chrome and empty-state composer do not match the real single-panel layout.
- **Side by Side** — close, but each panel's chat header is missing information present in the real app.
- **Kanban** — close; only minor polish needed.

This undermines the product claim that the marketing page shows the real ADE.

## Goal

The four landing showcase demos render the **same presentational shells** that the desktop app uses, so what visitors see on the landing page is visually identical to what they get when they launch the app. Going forward, visual drift must be impossible-by-construction: there should be one source of truth per view shell.

## Users & Value

- **Prospects on the landing page** — trust the screenshots because they *are* the app, not marketing approximations.
- **Acepe team** — one place to change each view's chrome; the website picks up changes for free.

## Scope

### In scope

1. **Visual parity, inert.** Demos remain non-interactive (`interactive=false` in `landing-demo-frame.svelte`). No click, no hover-to-expand, no state toggles beyond the existing top-level tab switcher.

2. **Single source of truth per shell.** Each of the four view layouts exists as a presentational component in `@acepe/ui` (`packages/ui`) that:
   - Takes data + label props, no store imports, no Tauri imports, no app-specific side effects
   - Is consumed by the desktop app via thin "controller" wrappers that feed it real data
   - Is consumed by the website with mock data, producing the exact same DOM and CSS

3. **Fidelity targets per view:**
   - **Side by Side:** Each panel's chat header shows full info (project/branch, agent, mode, status, menu affordances — whatever the real header currently renders).
   - **By Project:** Sidebar renders the real project list row design, session history rows, project header with agent selection, and the bottom icon footer (GitHub, X, Discord, version badge).
   - **Single Agent:** Full single-panel layout including the empty-state composer (project selector, branch picker, agent selector, input area) — same DOM as the real app's empty state, with mock-safe callbacks. The extraction includes presentational `@acepe/ui` shells for the composer's leaf controls: `AgentInput`, `BranchPicker`, `ProjectSelector`, `AgentSelector`, `PreSessionWorktreeCard`, and `AgentErrorCard`. Desktop rewires its existing call sites to compose these shells with store-backed props.
   - **Kanban:** Verify pixel parity with the real `kanban-view.svelte` shell; fix any remaining polish gaps.

4. **One viewport of truth.** Demos are tuned for desktop (the website demo frame is `aspect-[16/10.5]`). Mobile/narrow is acceptable best-effort, no new responsive commitments.

5. **Documentation.** Update `AGENTS.md` view-layer section if the extraction changes the MVC mapping for any of these components.

### Out of scope

- Interactivity in the demos (tab switching inside a demo, clickable sidebar items, etc.) — deferred; can be revisited after shipping option 1.
- Real data, real projects, live session lists — demos remain mock.
- Rewriting the underlying view logic. The goal is extracting existing visuals, not redesigning them.
- Internationalization of demo labels (they are marketing copy).
- Any change to the four outer selector pills or the tab switcher UX.
- Mobile-specific redesign of the showcase section.
- Other landing demo components rendered elsewhere on `+page.svelte` (`landing-checkpoints-demo.svelte`, `landing-permissions-demo.svelte`, `landing-plans-demo.svelte`, `git-features-demo.svelte`) — untouched by this work.

## Success Criteria

1. **DOM/CSS parity** — For each of the four views, a side-by-side visual comparison of the website demo and the running desktop app at a standard desktop viewport (≥1440px wide) shows no design-intent differences. Minor pixel noise from fonts, antialiasing, or shader background is acceptable. Missing or mis-styled elements are not.
2. **Single source of truth** — No hand-built chrome markup for sidebars, chat headers, panel containers, or empty-state layouts remains in `packages/website/src/lib/components/landing-*-demo.svelte` or `agent-panel-demo.svelte`. The website composes `@acepe/ui` shells with mock data.
3. **Website still builds and tests green** — `bun run check` and `bun test` pass in `packages/website`.
4. **Desktop still builds and tests green** — `bun run check` and `bun test` pass in `packages/desktop`; `cargo clippy` clean in `src-tauri/`.
5. **Architecture tests still pass** — `agent-panel-architecture.test.ts` (and any analogous architecture tests) continue to enforce the "no stores / no Tauri in `@acepe/ui`" rule on the newly extracted shells.

## Key Decisions

- **Option (b) extraction over option (a) screenshots** — The user explicitly chose reusing real components with mock data over screenshot-based matching. This is the durable answer and avoids drift.
- **Visual-only, inert (option 1)** — Interactivity deferred.
- **`@acepe/ui` is the home for extracted shells** — Matches the existing MVC split documented in `AGENTS.md` (View in `@acepe/ui`, Model mapper in desktop, Controller in desktop wrapper). Extraction follows the same pattern already used for the agent panel.

## Open Questions

None that block planning. The following belong in `/ce:plan`:

- Exact component boundaries and naming for each extracted shell (e.g., `AppSidebarShell`, `SingleAgentEmptyState`, `PanelChatHeader`).
- How the desktop app rewires its existing components to use the new extracted shells without regressing behavior.
- Which mock fixtures live in `packages/ui` (for website/storybook-style use) vs. in `packages/website/src/lib/components/landing-fixtures/`.
- Whether `sidebar-footer.svelte` becomes a pure-presentational shell that takes `githubUrl`, `xUrl`, `discordUrl`, `version` as props (desktop controller fetches version via Tauri; website passes a hardcoded mock version).

## Non-Functional Notes

- No new runtime dependencies expected.
- No data model or IPC surface changes.
- Extraction must preserve existing Svelte 5 rune patterns (no `$effect` for derived values, no `try/catch`, no `any`).
