<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";

import { cn, type WithElementRef } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLAttributes<HTMLTableRowElement>> = $props();
</script>

<tr
	bind:this={ref}
	data-slot="table-row"
	class={cn(
		"hover:bg-[color-mix(in_srgb,var(--muted)_15%,transparent)] data-[state=selected]:bg-muted border-b border-[color-mix(in_srgb,var(--border)_50%,transparent)] transition-colors",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</tr>
