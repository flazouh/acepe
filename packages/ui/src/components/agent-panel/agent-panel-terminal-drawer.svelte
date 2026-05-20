<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		height?: number | null;
		resizeHandle?: Snippet;
		tabs: Snippet;
		body: Snippet;
	}

	let { children: _children, height = null, resizeHandle, tabs, body }: Props = $props();
</script>

<div
	class="flex flex-col bg-background {height === null ? 'h-full' : ''}"
	style={height === null ? "contain: layout;" : `height: ${height}px; contain: layout;`}
>
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
