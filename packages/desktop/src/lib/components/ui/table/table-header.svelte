<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";

import { cn, type WithElementRef } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLAttributes<HTMLTableSectionElement>> = $props();
</script>

<thead
	bind:this={ref}
	data-slot="table-header"
	class={cn("[&_tr]:border-b bg-[color-mix(in_srgb,var(--muted)_30%,transparent)]", className)}
	{...restProps}
>
	{@render children?.()}
</thead>
