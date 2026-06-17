<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		widthStyle: string;
		isDragging?: boolean;
		isFillContainer?: boolean;
		header: Snippet;
		body: Snippet;
		resizeEdge?: Snippet;
	}

	let {
		children: _children,
		widthStyle,
		isDragging = false,
		isFillContainer = false,
		header,
		body,
		resizeEdge,
	}: Props = $props();
</script>

<div
	class="flex flex-col h-full min-h-0 bg-background overflow-hidden relative {isDragging
		? 'select-none'
		: ''} {isFillContainer ? 'flex-1 min-w-0' : 'shrink-0 grow-0 border border-border'}"
	style={widthStyle}
>
	<div class="shrink-0">
		{@render header()}
	</div>

	{@render body()}

	{#if resizeEdge}
		{@render resizeEdge()}
	{/if}
</div>
