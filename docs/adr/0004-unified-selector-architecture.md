# ADR-0004: Unified selector architecture

## Status

Accepted

## Context

Composer and agent-panel pickers grew through parallel paths: `Selector`, `ComposerOverflowMenu`, `ComposerFilterDropdown`, and ad-hoc `DropdownMenu.Root` shells. Row markup was duplicated across `AgentInputSelectorItemRow`, `AgentInputModelRow`, and `AgentInputModelSelectorItemRow`. Trigger styling was overridden per component instead of using `triggerSize` tokens.

This made it hard to answer "what component is the model/voice/branch picker?" and risky to change fused-chip padding or icon size app-wide.

## Decision

Adopt a **four-primitive selector kit** in `packages/ui/src/components/selector/`:

1. **`Selector`** — the only owner of `DropdownMenu.Root` / trigger / content shell
2. **`SelectorItem`** — selectable or action row (`DropdownMenu.Item` wrapper)
3. **`SelectorPanel`** — optional sticky search + scroll body inside a selector
4. **`selector-trigger-classes.ts`** — single `triggerSize` vocabulary

**One compositional recipe** for all domain presenters (`agent-input-*-selector`, `*-menu`):

```
Selector → renderButton snippet → SelectorPanel (optional) → SelectorItem rows
```

Fused controls (model + reasoning, mic + voice) use `FusedPrimaryOverflowGroup` to lay out two `Selector`s; the group is layout only, not a menu type.

**Naming:** `*-selector` picks a value; `*-menu` is actions or mixed content. No `*Dropdown*` or `*OverflowMenu*` in product exports.

**Layers:**

| Layer | Package | Role |
|-------|---------|------|
| Kit | `@acepe/ui/selector` | Shell, row, panel, tokens |
| Domain presenter | `@acepe/ui` agent-panel | Domain labels, item mapping |
| Controller | `packages/desktop` | Stores, Tauri, session policy — no menu shell markup |

`DropdownMenu.Item`, `Sub`, `Separator`, `RadioGroup`, and `Label` remain allowed **inside** selector content. `DropdownMenu.Root` is forbidden outside the kit (enforced by lint).

## Consequences

**Better**

- One place to change trigger/surface behavior
- Domain files follow the same recipe; easier onboarding
- Lint prevents new ad-hoc dropdown shells

**Worse**

- Short-term migration churn across agent-panel and desktop controllers
- Submenus still use bits-ui `DropdownMenu.Sub` directly in content (no submenu primitive yet)

**We owe**

- Keep `triggerSize` tokens complete for composer, setup bar, and header actions
- Visual QA on fused chips after selector changes
- Deprecate removed exports (`ComposerOverflowMenu`, `ComposerFilterDropdown`, row wrappers) in the same milestone
