<script lang="ts">
	import type { Snippet } from "svelte";

	import { cn } from "../../lib/utils.js";

	interface Props {
		fullscreen?: boolean;
		class?: string;
		rowClass?: string;
		children?: Snippet;
	}

	let {
		fullscreen = false,
		class: className = "",
		rowClass = "",
		children,
	}: Props = $props();
</script>

<div class={cn("flex flex-col flex-1 min-h-0 gap-0.5", className)}>
	<div
		class={cn(
			"flex flex-row items-stretch gap-0.5 flex-1 min-h-0",
			fullscreen ? "overflow-hidden" : "overflow-x-auto overflow-y-hidden",
			rowClass
		)}
	>
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>
