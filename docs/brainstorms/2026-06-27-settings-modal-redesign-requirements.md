# Settings Modal Redesign — Requirements

- **Date:** 2026-06-27
- **Status:** Ready for planning
- **Scope tier:** Deep — feature (visual/structural redesign within existing product shape)
- **Owner:** Alex

## Problem

The agent panel (header, composer, tool calls) is UI the user finds genuinely satisfying: dense, divider-structured, restrained, with a tight type hierarchy. The settings modal does not share that feel. Today it reads like a generic web-settings page:

- The modal frame has **no chrome** beyond a bare floating `✕` (no title bar, no structure).
- Rows are **loose and flat** — toggles stranded far-right over dead space, no dividers, no density.
- One **flat surface** — no use of the subtle borders/surfaces that give the panel depth.
- Type is **larger and softer** than the panel's `text-[12px]` / `text-[11px]` + `muted-foreground` rhythm.

Baseline captured live (dev app, General section) on 2026-06-27. Structural audit and the agent-panel design-language spec were produced as grounding (see Context).

## Goal

Redesign the **entire** settings modal so it belongs to the same visual family as the agent panel — without copying the panel's busy header. The agent-panel quality being borrowed is **density + restraint + subtle dividers + tight type hierarchy**, applied to the settings content, sidebar, and frame.

## Decisions (locked with user)

1. **Frame chrome — minimal.** A clean header: `Settings` title top-left, close `✕` top-right. **No** divider-cell header bar (we are *not* porting `EmbeddedPanelHeader`'s cell/divider chrome). The frame stays quiet; the discipline shows up in the content.
2. **Row style — dense divider rows.** Within a section: a small subsection label, then rows separated only by `border-border/50` dividers. **No** card containers around groups, **no** per-setting boxes. Leaner and denser than today.
3. **Scope — everything in one pass.** Redesign the shared shell/sidebar/primitives **and** hand-tune all 14 sections together before shipping.

## Design language to adopt (from the agent panel)

These are the concrete tokens/patterns the redesign should converge on (full spec in the design-language grounding):

- **Type hierarchy:** primary `text-[12px] font-medium text-foreground`; secondary/description `text-[11px] text-muted-foreground` (≈/70 opacity); group labels `text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground`.
- **Dividers:** `border-border/50` for row separators and the sidebar edge; `last:border-b-0`.
- **Density:** row padding in the `py-1`–`py-1.5` range, content gaps `gap-1.5`, control column tight to the right edge (no huge dead gap).
- **Surfaces:** lean on `bg-card` / `bg-input/10` / `bg-background` layering already used by the panel; hover via `bg-accent/50`, `transition-colors duration-150`.
- **Focus/interaction:** `focus-visible:ring-ring/50` rings, opacity reveals on hover where appropriate, restrained motion.
- **Iconography:** existing sets (tabler/phosphor), `size-3.5`/`size-3`, color via `text-muted-foreground` → `text-foreground` on active/hover.

## In scope

- Modal **shell**: frame, sizing, minimal header (title + close), scroll region.
- **Sidebar** nav: keep the 4-group structure (General / Agents / Workspace / Data) and all section entries; restyle to panel density (group labels, active = `bg-accent`/`text-foreground`, inactive = `text-muted-foreground`, dense rows, subtle edge).
- **Shared primitives**: `SettingRow`, `SettingsSection`, `SettingsSectionHeader`, `SettingsPageHeader`, `SettingsComingSoon` — restyled to the new language so every section inherits it.
- **All 14 sections** verified/hand-tuned against the new primitives: General, Appearance, Keybindings, Agents & models, Chat, Voice, Skills, MCP servers, Projects, Worktrees, Environments, Git, Archived sessions, Usage.
- Light/dark parity using existing tokens.

## Out of scope (this redesign)

- No change to **settings behavior, values, persistence, or section taxonomy** — same controls, same Tauri/SQLite read/write paths, same sections. This is visual/structural only.
- No new settings, no removed settings, no re-grouping of the nav.
- No port of the agent-panel `EmbeddedPanelHeader` cell/divider header (explicitly declined).
- Not converting toggles/selects to new control components unless required for the look; reuse existing `Switch`, `Selector`, etc.
- The heavy interaction logic in `agents-models-section` (preconnection warming, model caching, env dialog) is **restyled, not re-architected**.

## Success criteria

- Side-by-side, the settings modal reads as the **same family** as the agent panel: dense, divider-structured, restrained, tight type — confirmed visually (light + dark) via live DOM/screenshot QA.
- The frame is chrome-light (title + close), with the discipline carried by content/sidebar/dividers — matching the locked decisions.
- All 14 sections render correctly with the new primitives; no loose far-right toggles, consistent row density, consistent type hierarchy across sections.
- No behavioral regressions: every control still reads/writes the same value (toggles, selectors, danger zone, project form, voice models, agents/models).
- `bun run check` clean; existing settings tests pass; UI-package boundary respected for any shared components.

## Constraints / project rules

- **UI MVC split**: any genuinely reusable, presentational pieces belong in `@acepe/ui` (invoke `extract-to-ui-package`); desktop keeps Controller wrappers. Settings-specific shells can stay desktop-local if not reusable.
- **Svelte 5**: runes only, no `$effect` for derivations; invoke svelte skills before editing components.
- **TypeScript**: neverthrow over try/catch; no `any`/`unknown`; no spread for provenance.
- **Visual QA mandatory** after UI changes (acepe-dev-app-qa): doctor → observe → inspect → screenshot, light + dark.
- Not a session/transcript-shaped data path — GOD architecture gate not triggered (verify if any change reaches session data; it should not).

## Open questions (resolve in planning, not blocking)

- Exact sidebar width (keep 168px vs tighten) — decide during implementation against the new density.
- Whether `SettingRow`/`SettingsSection` are reusable enough to promote to `@acepe/ui`, or stay desktop-local — decide via `extract-to-ui-package` heuristics during planning.
- Whether the chrome-light header still wants the section's gear/icon as a quiet accent next to the title (allowed; not a divider cell).

## Context / grounding artifacts

- **Structural audit** of current settings modal (entry point, shell `settings-page.svelte`, sidebar `settings-sidebar.svelte`, registry `settings-section-registry.ts`, primitives `setting-row.svelte` / `settings-section*.svelte`, 14 sections under `sections/`, persistence via `tauri-client/settings.ts` + stores) — produced 2026-06-27.
- **Agent-panel design-language spec** (tokens in `app.css` / `packages/ui/src/lib/design-tokens.css`, header cell patterns in `packages/ui/src/components/panel-header/`, spacing/type/interaction patterns) — produced 2026-06-27.
- **Live visual baseline** screenshot of General section — captured 2026-06-27.
