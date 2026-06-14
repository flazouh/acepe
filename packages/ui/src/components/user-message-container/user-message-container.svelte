<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "../../lib/utils.js";

	interface Props {
		class?: string;
		contentClass?: string;
		content?: Snippet;
		footer?: Snippet;
		children?: Snippet;
	}

	let {
		class: className = "",
		contentClass = "px-2 py-1",
		content,
		footer,
		children,
	}: Props = $props();
</script>

<div class={cn("relative h-fit flex flex-col rounded-lg bg-input/30", className)}>
	<div class={contentClass}>
		{#if content}
			{@render content()}
		{:else if children}
			{@render children()}
		{/if}
	</div>
	{#if footer}
		<div class="flex h-7 items-center justify-between gap-2 border-t border-border/50">
			{@render footer()}
		</div>
	{/if}
</div>