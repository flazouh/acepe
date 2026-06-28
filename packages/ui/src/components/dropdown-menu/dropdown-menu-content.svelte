<script lang="ts">
	import type { ComponentProps, Snippet } from "svelte";

	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { type WithoutChildrenOrChild } from "../../lib/utils";

	import SurfaceProvider from "../../lib/surface-provider.svelte";
	import { clampSurfaceLevel, DROPDOWN_SURFACE_OFFSET } from "../../lib/surface-classes.js";
	import { getSurfaceLevel } from "../../lib/surface-context.js";

	import DropdownMenuHighlightLayer from "./dropdown-menu-highlight-layer.svelte";
	import DropdownMenuPortal from "./dropdown-menu-portal.svelte";
	import { buildDropdownMenuSurfaceClassName } from "./dropdown-menu-surface.classes.js";

	const substrateLevel = getSurfaceLevel();
	const menuSurfaceLevel = clampSurfaceLevel(substrateLevel + DROPDOWN_SURFACE_OFFSET);

	let {
		ref = $bindable(null),
		sideOffset = 4,
		portalProps,
		class: className,
		children,
		...restProps
	}: DropdownMenuPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DropdownMenuPortal>>;
		children?: Snippet;
	} = $props();
</script>

<DropdownMenuPortal {...portalProps}>
	<DropdownMenuPrimitive.Content
		bind:ref
		data-slot="dropdown-menu-content"
		{sideOffset}
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
	</DropdownMenuPrimitive.Content>
</DropdownMenuPortal>
