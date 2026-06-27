<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";

	import { type WithElementRef, cn } from "../../lib/utils";
	import { dropdownMenuSectionTypographyClass } from "./dropdown-menu-typography.js";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		inset?: boolean;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="dropdown-menu-label"
	data-inset={inset}
	class={cn("px-2 py-1 text-muted-foreground border-b border-border/20 last:border-b-0 data-[inset]:ps-8", dropdownMenuSectionTypographyClass, className)}
	{...restProps}
>
	{@render children?.()}
</div>
