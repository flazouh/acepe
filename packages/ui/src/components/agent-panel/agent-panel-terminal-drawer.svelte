<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		height: number;
		resizeHandle?: Snippet;
		tabs: Snippet;
		body: Snippet;
	}

	let { children: _children, height, resizeHandle, tabs, body }: Props = $props();
</script>

<div class="flex flex-col bg-background" style="height: {height}px; contain: layout;">
	{#if resizeHandle}
		{@render resizeHandle()}
	{/if}

	<div class="flex items-stretch h-7 shrink-0 border-b border-border/50" role="tablist">
		{@render tabs()}
	</div>

	<div class="flex-1 min-h-0 overflow-hidden relative">
		{@render body()}
	</div>
</div>
