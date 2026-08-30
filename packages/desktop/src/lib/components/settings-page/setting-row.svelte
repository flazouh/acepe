<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "$lib/utils.js";

interface Props {
	label: string;
	description?: string;
	/** When true, control renders below label/description instead of to the right (full-width controls). */
	stacked?: boolean;
	class?: string;
	children: Snippet;
}

let { label, description, stacked = false, class: className, children }: Props = $props();
</script>

<div
	class={cn(
		"border-b border-border/60 px-3 py-2 last:border-b-0",
		stacked ? "flex flex-col gap-1.5" : "flex items-center justify-between gap-4",
		className
	)}
>
	<div class={cn("min-w-0", stacked ? "w-full" : "max-w-[28rem] flex-1")}>
		<div class="text-[13px] font-medium leading-5 text-foreground">{label}</div>
		{#if description}
			<div class="mt-0.5 text-[12px] leading-snug text-muted-foreground">{description}</div>
		{/if}
	</div>
	<div class={stacked ? "w-full" : "shrink-0"}>
		{@render children()}
	</div>
</div>
