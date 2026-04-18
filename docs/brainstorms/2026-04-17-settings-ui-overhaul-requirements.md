---
date: 2026-04-17
topic: settings-ui-overhaul
---

# Settings UI Overhaul — Codex-style Reorganization and Visual Refresh

## Problem Frame

Acepe's Settings page has grown organically into 9 loosely-organized sections (`General`, `Chat`, `Keybindings`, `Agents & models`, `Voice`, `Skills`, `Worktrees`, `Project`, `Archived sessions`). The taxonomy mixes user-facing concepts (Chat, Voice) with internal structure (Project overrides), and the per-setting card layout — tiny `rounded-sm` cards with gaps between them — makes scanning a section visually noisy and each setting feel isolated.

With ~8 new settings queued from issues #133–#140 (default agent behavior, bypass permission mode, worktree-on-by-default, env file copy, setup command defaults, archive/delete hooks, run scripts) the current structure will not absorb them cleanly. Issue #141 is the already-fixed Cmd+W tracker and is not queued work. This overhaul re-homes every section against a Codex-style category scheme and rebuilds the visual system around grouped cards with inner dividers and a consistent control vocabulary.

Users benefit from predictable category naming (matching the reference they intuited from Codex), a denser and more scannable page, and stable surfaces for every queued feature to land in.

## Requirements

**Category Structure**

- R1. The settings sidebar exposes 11 top-level categories in this order: **General**, **Appearance**, **Configuration**, **Personalization**, **Keybindings**, **MCP servers**, **Git**, **Environments**, **Worktrees**, **Archived sessions**, **Usage**.
- R2. **General** contains non-visual app behavior: startup, language, notifications, attention queue, analytics, database reset.
- R3. **Appearance** is extracted from today's `general-section` and contains theme (today) and placeholders for density/font (future). It must not duplicate content with General.
- R4. **Configuration** merges today's `agents-models-section` content plus the `chat-section` content, and is the home for the new settings coming from issues #133 (default agent), #134 (per-agent harness settings), #136 (bypass permission default), and per-agent model defaults already persisted in `AgentModelPreferencesStore`.
- R5. **Personalization** merges today's `voice-section` and `skills-section`, and reserves space for future custom instructions / profile content.
- R6. **Keybindings** keeps its current role as the shortcut editor (today implemented by `packages/desktop/src/lib/components/settings/keybindings-tab.svelte`) and remains a top-level entry despite not existing in the Codex reference. It is moved into `sections/` as `keybindings-section.svelte` to match the other categories' layout.
- R7. **MCP servers** and **Usage** are surfaced as top-level entries with polished "Coming soon" empty states (R16) until real content exists.
- R8. **Git** is a new top-level section covering git-related preferences (branch naming conventions, diff viewer behavior, git-adjacent flags that currently live inside Worktrees config).
- R9. **Environments** is a new top-level section covering env-file copy allowlist (issue #137) and per-agent env overrides (today's `agent-env-overrides-dialog`).
- R10. **Worktrees** covers global worktree default (issue #135), setup commands (issue #138), run commands (issue #139), archive/delete hooks (issue #140), and project-level overrides where relevant.
- R11. **Archived sessions** retains its current scope unchanged.
- R12. Today's `chat-section` folds into **Configuration**; today's `ProjectTab` content (wired at `settings-page.svelte:72`) is distributed into **Worktrees**, **Environments**, and **Configuration** as contextual per-project override rows, with no dedicated Project top-level entry.
- R13. Deep-linking to any section by id must continue to work; the section-id enum (`SettingsSectionId`) expands to cover the new categories and maps missing / legacy ids to the closest new home on first load (no user-visible error).

**Visual System**

- R14. Each section renders as **one grouped rounded card** containing all of its rows, with subtle inner `border-b` dividers between rows. This replaces the per-setting `SettingsControlCard` pattern where a section previously produced multiple small cards with gaps.
- R15. The section header (title + description) sits **outside** the grouped card, above it, matching the Codex reference.
- R16. "Coming soon" placeholder sections (MCP, Usage) use the same grouped-card shell with a single centered, polished empty-state row: icon + short headline + one-sentence description. Matches the rest of the page's rhythm; no blank / broken feel.
- R17. Corner radius, border color, and row padding are tuned to feel closer to the Codex reference than today's `rounded-sm` tiny cards. Exact values are chosen in planning but must read as "one continuous surface per section".
- R18. The existing per-setting `SettingsControlCard` primitive is retained **only** for standalone emphasized settings that need to break out of the grouped flow — destructive actions (e.g., reset DB) and settings whose control has rich inline expandable content (e.g., setup commands editor). It is not the default row primitive anymore.
- R19. Typography and density read as more compact than today: row label, description, and control fit on a single row at default widths, with description wrapping to a subdued second line only when present. Matches reference density (`text-[13px]` label, `text-[12px]` muted description, as already in `setting-row.svelte`).

**Control Conventions**

- R20. Controls map to primitives consistently across all sections per this table:
  | Setting type | Primitive |
  |---|---|
  | Binary on/off | `Switch` |
  | 2–4 enum options | `SegmentedToggleGroup` pill (reused from `pre-session-worktree-card`) |
  | 5+ options or dynamic list (models, agents, languages) | Dropdown / combobox |
  | Opens a richer editor (keybinding capture, env overrides, setup commands) | Ghost `Button` labeled **Set** / **Edit** → dialog or inline expandable section |
  | Destructive one-shot (reset DB, delete archive) | `Button` destructive variant + confirm dialog |
  | Opens external / inline content (archive list, skills list) | Full-width block below the grouped card (still in-section) |
- R21. Inconsistent existing usages (e.g., a Switch where a pill would be clearer, or a dropdown for a 2-option setting) are rewritten to conform to R20 as part of the overhaul.

**Migration**

- R22. All persisted settings keep their current storage keys; no user data migration is required. Only the *presentation* moves between sections.
- R23. User-visible strings for the new category labels and any rows that change wording are updated in place; unchanged wording stays as-is.
- R24. Each existing section file is either renamed/repointed or split; the overhaul leaves the `sections/` directory with one file per top-level category and no dead code.

## Success Criteria

- Sidebar shows 11 top-level entries in the R1 order on first open with no category obviously out of place.
- A user opening any existing setting can find it in at most one wrong guess (Chat → Configuration, Voice → Personalization, etc.), verified by dogfooding against the list of current settings.
- Every section reads as a single continuous card with inner dividers; no section renders as a stack of small isolated cards.
- MCP servers and Usage have a visually intentional empty state that does not look broken or unfinished.
- Every control follows the R20 primitive mapping; no Switch stands in for what should be a pill and vice versa.
- All 8 queued features from issues #133–#140 have a clearly-named section in the new structure where their settings will land, with no "where does this go?" ambiguity for planners.
- `bun run check` passes after the overhaul with no type regressions, and no persisted user preferences are lost across the refactor.

## Scope Boundaries

- Not implementing any of the feature behaviors from issues #133–#141 in this overhaul. This overhaul only reshapes the surfaces those features will land on.
- Not touching non-Settings UI surfaces (agent panel, sidebar, composer). The worktree-card pill component is *reused* here but not redesigned.
- Not introducing new persisted user preferences. Any new settings needed by queued features are added in their own planning cycles; this overhaul must be shippable even if none of those features land.
- Not rebuilding the Settings shell (modal framing, close behavior, keyboard nav) — only the sidebar, section header, and row primitives within.
- Not adding real MCP server or Usage telemetry — only their Coming Soon placeholders.
- Not changing the Archived Sessions content or behavior; only its sidebar label and visual container.
- Not adding new design tokens beyond what the existing theme provides; the Codex-inspired feel is achieved by composing existing tokens with adjusted radius, border, and spacing.

## Key Decisions

- **Codex structure as the baseline, not pixel-for-pixel clone.** We adopt the categories that translate to Acepe features and keep Acepe-specific sections (Keybindings) that don't appear in Codex. Usage and MCP are planned entries with Coming Soon states. Computer Use is explicitly dropped because it has no Acepe analogue.
- **Grouped card per section replaces per-setting card as the default.** The per-setting card is repurposed as a "standalone emphasized" primitive. This is the biggest visual shift and carries the most of the reference's feel.
- **Chat folds into Configuration; Project distributes contextually.** Two fewer top-level entries; classification is purely behavior-driven rather than mirroring the old file layout.
- **Every MCP / Usage placeholder uses the same polished empty-state shell.** No "TODO" text or broken-looking panels; consistency matters for perceived quality of the whole Settings page.
- **Control conventions are codified in R20** so later feature planning (issues #133–#141) does not re-litigate control choice per setting.

## Dependencies / Assumptions

- `SegmentedToggleGroup` in `@acepe/ui/panel-header` is the pill primitive used by the worktree card and is reusable across Settings. (Verified: `packages/ui/src/components/agent-panel/pre-session-worktree-card.svelte:13,58-61`.)
- Current Settings primitives (`setting-row.svelte`, `settings-section.svelte`, `settings-section-header.svelte`) already implement the row and header shape close enough to the Codex reference that the main rebuild work is in replacing `settings-control-card.svelte` and consolidating section files, not reinventing primitives.
- Settings copy lives as English strings in the Settings Svelte components; new category labels are added where needed.
- No external design system or token changes are required; existing Tailwind theme tokens are sufficient.
- Feature issues #133–#141 will land *after* this overhaul and are planned separately.

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R17][Technical] Exact corner radius, border color token, and row padding values that best match the reference without diverging from the broader Acepe visual language — pick during planning by comparing side-by-side against existing card components (e.g., `checkpoint-card`, `project-card`).
- [Affects R8, R9][Technical] Which current settings live in today's `general-section` / `worktrees-section` / `agents-models-section` need to be *moved into* the new Git / Environments / Configuration sections, and which are new scaffolding — enumerate per current file during planning.
- [Affects R13][Technical] Mapping table from legacy `SettingsSectionId` values to new ids, including which legacy ids are dropped (`project`, `chat`) and how deep links to those are redirected — decide during planning.
- [Affects R12][Technical] Where specifically each row in today's `ProjectTab` (and nested sub-tabs, if any) lands (per row, not per section) — best done during planning with the file open.
- [Affects R16][Technical] Choice of icon and illustration level for Coming Soon placeholders — during planning; should match Acepe's empty-state conventions in `empty-states.svelte`.

## Next Steps

-> `/ce:plan` for structured implementation planning
