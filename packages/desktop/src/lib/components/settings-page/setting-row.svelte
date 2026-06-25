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
		"border-b border-border/30 py-1.5 last:border-b-0",
		stacked ? "flex flex-col gap-1.5" : "flex items-center justify-between gap-3",
		className
	)}
>
	<div class="min-w-0 flex-1 pr-1">
		<div class="text-xs font-medium leading-4 text-foreground">{label}</div>
		{#if description}
			<div class="mt-0.5 text-[11px] leading-snug text-muted-foreground/60">{description}</div>
		{/if}
	</div>
	<div class={stacked ? "w-full" : "shrink-0"}>
		{@render children()}
	</div>
</div>
