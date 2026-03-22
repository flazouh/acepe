<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";

import { cn, type WithElementRef } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="alert-dialog-header"
	class={cn("flex flex-col gap-1 text-start pb-2.5 mb-2.5 border-b border-border/20", className)}
	{...restProps}
>
	{@render children?.()}
</div>
