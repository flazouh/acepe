<script lang="ts">
	import type { Snippet } from "svelte";

	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

	import SurfaceProvider from "../../lib/surface-provider.svelte";
	import { clampSurfaceLevel, DROPDOWN_SURFACE_OFFSET } from "../../lib/surface-classes.js";
	import { getSurfaceLevel } from "../../lib/surface-context.js";

	import DropdownMenuHighlightLayer from "./dropdown-menu-highlight-layer.svelte";
	import { buildDropdownMenuSurfaceClassName } from "./dropdown-menu-surface.classes.js";

	const substrateLevel = getSurfaceLevel();
	const menuSurfaceLevel = clampSurfaceLevel(substrateLevel + DROPDOWN_SURFACE_OFFSET);

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: DropdownMenuPrimitive.SubContentProps & {
		children?: Snippet;
	} = $props();
</script>

<DropdownMenuPrimitive.SubContent
	bind:ref
	data-slot="dropdown-menu-sub-content"
	class={buildDropdownMenuSurfaceClassName(className, substrateLevel)}
	{...restProps}
>
	<SurfaceProvider level={menuSurfaceLevel}>
		<DropdownMenuHighlightLayer>
			{#if children}
				{@render children()}
			{/if}
		</DropdownMenuHighlightLayer>
	</SurfaceProvider>
</DropdownMenuPrimitive.SubContent>
