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
		"border-b border-border/40 px-4 py-3 last:border-b-0",
		stacked ? "flex flex-col gap-2" : "flex items-center justify-between gap-4",
		className
	)}
>
	<div class="flex-1 min-w-0 pr-1">
		<div class="text-[13px] font-medium leading-5">{label}</div>
		{#if description}
			<div class="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/60">{description}</div>
		{/if}
	</div>
	<div class={stacked ? "w-full" : "shrink-0"}>
		{@render children()}
	</div>
</div>
