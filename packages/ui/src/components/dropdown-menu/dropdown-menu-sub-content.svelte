<script lang="ts">
	import type { Snippet } from "svelte";

	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

	import DropdownMenuHighlightLayer from "./dropdown-menu-highlight-layer.svelte";
	import { buildDropdownMenuSurfaceClassName } from "./dropdown-menu-surface.classes.js";

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
	class={buildDropdownMenuSurfaceClassName(className)}
	{...restProps}
>
	<DropdownMenuHighlightLayer>
		{#if children}
			{@render children()}
		{/if}
	</DropdownMenuHighlightLayer>
</DropdownMenuPrimitive.SubContent>
