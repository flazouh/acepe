<script lang="ts">
	import { cn } from "../../lib/utils.js";

	interface Props {
		insertions: number;
		deletions: number;
		/** "pill" = rounded pill with background (default), "plain" = just the diff text */
		variant?: "pill" | "plain";
		class?: string;
	}

	let { insertions = 0, deletions = 0, variant = "pill", class: className }: Props = $props();

	const hasChanges = $derived(insertions > 0 || deletions > 0);
	const isPlain = $derived(variant === "plain");
</script>

{#if hasChanges}
	<span
		class={cn(
			"inline-flex items-center gap-1.5 font-mono text-[0.6875rem] font-medium leading-none",
			isPlain ? "gap-1" : "px-2 py-1.5 rounded-full bg-muted/50 gap-1.5",
			className
		)}
	>
		{#if insertions > 0}
			<span class="text-success diff-pill-value-add">+{insertions}</span>
		{/if}
		{#if deletions > 0}
			<span class="text-destructive diff-pill-value-remove">-{deletions}</span>
		{/if}
	</span>
{/if}

