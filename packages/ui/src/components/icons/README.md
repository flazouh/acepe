# Hugeicons

Acepe uses one shared Svelte renderer for product icons:

```svelte
<script lang="ts">
	import { HugeiconsIcon } from "@acepe/ui/icons";
</script>

<HugeiconsIcon name="folder" class="size-4 text-muted-foreground" />
```

The registry maps product names to Hugeicons data and keeps icon rendering in
one place. It also exposes `hugeiconsIconLibrary` for pickers and the web
design-system page.

The checked-in package currently uses Hugeicons' free Stroke Rounded data. The
private Solid Rounded package can replace the registry source once the project
license is configured; no application call sites need to change.

```ts
import {
	HugeiconsIcon,
	hugeiconsIconLibrary,
	type HugeiconsIconName,
} from "@acepe/ui/icons";
```

Icons use `currentColor`. Decorative icons omit `aria-label`; meaningful icons
should provide one.

All product call sites use `HugeiconsIcon`; this package does not ship an
app-owned SVG catalog or legacy icon renderer.
