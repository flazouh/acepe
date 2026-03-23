<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";

import { cn, type WithElementRef } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<kbd
	bind:this={ref}
	data-slot="kbd"
	class={cn(
		"bg-input border border-border text-muted-foreground pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm px-1 font-sans text-xs font-medium select-none",
		"[&_svg:not([class*='size-'])]:size-3",
		"[[data-slot=tooltip-content]_&]:bg-white/10 [[data-slot=tooltip-content]_&]:text-foreground [[data-slot=tooltip-content]_&]:border-border/50",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</kbd>
