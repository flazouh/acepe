# Rounded Icons

Acepe's rounded icons have clean SVG files as their source of truth:

```text
svg/
  folder.svg
  settings.svg
  terminal.svg
  arrow-right.svg
```

Acepe's product UI uses them through one Svelte API:

```svelte
<script lang="ts">
	import { RoundedIcon } from "@acepe/ui/icons";
</script>

<RoundedIcon name="folder" class="size-4 text-muted-foreground" />
```

Use clean names in app code:

```svelte
<RoundedIcon name="settings" />
<RoundedIcon name="terminal" />
<RoundedIcon name="arrow-right" />
<RoundedIcon name="copy" />
```

Some alternate names also work:

```text
bell    -> automations
browser -> globe
files   -> folders
```

Use `recommendedRoundedIconNames` or `roundedIconLibrary` for icon pickers.

## Public Exports

Import everything from `@acepe/ui/icons`.

```ts
import {
	RoundedIcon,
	recommendedRoundedIconNames,
	roundedIconLibrary,
	resolveRoundedIconName,
	type RoundedIconName,
} from "@acepe/ui/icons";
```

Useful exports:

| Export | Purpose |
| --- | --- |
| `RoundedIcon` | Svelte component that renders an inline SVG. |
| `RoundedIconName` | Type for all valid clean names and alternate names. |
| `recommendedRoundedIconNames` | Primary clean names to show in pickers. |
| `roundedIconLibrary` | Pretty icon metadata: `name`, `fileName`, and display `label`. |
| `roundedIconAliasNames` | Alternate names only, such as `browser` for `globe`. |
| `roundedIconNames` | Primary clean SVG names. |
| `roundedIconSourceNames` | Backwards-compatible export for primary clean SVG names. |
| `resolveRoundedIconName` | Converts an alternate name to the primary clean SVG name. |

## Styling

Icons use `currentColor`, so style them with normal text color classes:

```svelte
<RoundedIcon name="check-circle" class="size-4 text-emerald-500" />
<RoundedIcon name="warning" class="size-4 text-amber-500" />
```

For decorative icons, omit `aria-label`. The component sets `aria-hidden="true"`.

```svelte
<RoundedIcon name="folder" class="size-4" />
```

For meaningful icons, add `aria-label`.

```svelte
<RoundedIcon name="warning" aria-label="Warning" class="size-4" />
```

## Building An Icon Picker

Use `roundedIconLibrary` when you need a clean grid, search list, or command palette.

```svelte
<script lang="ts">
	import { RoundedIcon, roundedIconLibrary } from "@acepe/ui/icons";
</script>

{#each roundedIconLibrary as icon (icon.name)}
	<button type="button" title={icon.label}>
		<RoundedIcon name={icon.name} class="size-4" />
		<span>{icon.label}</span>
	</button>
{/each}
```

## Moving To Another Project

For another project, copy the framework-agnostic source and data first:

```text
icons/
  svg/
    folder.svg
    settings.svg
    terminal.svg
  rounded-icon-data.generated.ts
  rounded-icon-library.ts
  index.ts
```

Then add a thin adapter for the target framework.

For Svelte:

```svelte
<script lang="ts">
	import { RoundedIcon } from "$lib/icons";
</script>
```

For React, render `roundedIconData[resolveRoundedIconName(name)]` inside an
`<svg>` and set the SVG body with React's trusted HTML escape hatch.

Keep `rounded-icon-data.generated.ts` generated. Do not edit it by hand. The
human-readable source is `svg/*.svg`. The source generator is:

```text
packages/ui/scripts/generate-rounded-icons.mjs
```

The component renders trusted generated SVG markup with `{@html icon.inner}`.
Do not add an API that accepts arbitrary SVG strings from users.
