<script lang="ts">
	import type { ComponentProps, Snippet } from "svelte";

	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { type WithoutChildrenOrChild } from "../../lib/utils";

	import DropdownMenuHighlightLayer from "./dropdown-menu-highlight-layer.svelte";
	import DropdownMenuPortal from "./dropdown-menu-portal.svelte";
	import { buildDropdownMenuSurfaceClassName } from "./dropdown-menu-surface.classes.js";

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
		class={buildDropdownMenuSurfaceClassName(className)}
		{...restProps}
	>
		<DropdownMenuHighlightLayer>
			{#if children}
				{@render children()}
			{/if}
		</DropdownMenuHighlightLayer>
	</DropdownMenuPrimitive.Content>
</DropdownMenuPortal>
