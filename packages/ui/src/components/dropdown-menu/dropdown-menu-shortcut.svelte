<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";

	import { type WithElementRef, cn } from "../../lib/utils";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<span
	bind:this={ref}
	data-slot="dropdown-menu-shortcut"
	class={cn("text-muted-foreground ms-auto text-[11px] font-medium tracking-widest", className)}
	{...restProps}
>
	{@render children?.()}
</span>
