<script lang="ts">
import type { HTMLThAttributes } from "svelte/elements";

import { cn, type WithElementRef } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLThAttributes> = $props();
</script>

<th
	bind:this={ref}
	data-slot="table-head"
	class={cn(
		"text-muted-foreground h-9 bg-clip-padding px-3 py-2 text-start align-middle font-medium text-[0.6875rem] uppercase tracking-wide whitespace-nowrap border-b border-border [&:has([role=checkbox])]:pe-0",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</th>
