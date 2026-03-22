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
	data-slot="dialog-footer"
	class={cn("flex flex-row justify-end gap-1.5 pt-2.5 mt-2.5 border-t border-border/20", className)}
	{...restProps}
>
	{@render children?.()}
</div>
