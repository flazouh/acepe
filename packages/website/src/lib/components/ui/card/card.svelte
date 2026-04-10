<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";
import { cn } from "$lib/utils.js";

let { class: className, children, ...restProps }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
	data-slot="card"
	class={cn(
		"bg-card/70 text-card-foreground flex flex-col rounded-xl p-4 shadow-md",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
