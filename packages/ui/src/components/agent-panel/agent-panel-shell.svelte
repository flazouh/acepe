<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		widthStyle?: string;
		centerColumnStyle?: string;
		isFullscreen?: boolean;
		isDraggingEdge?: boolean;
		children?: Snippet;
		onclick?: ((event: MouseEvent) => void) | undefined;
		onkeydown?: ((event: KeyboardEvent) => void) | undefined;
		ondragstart?: ((event: DragEvent) => void) | undefined;
		header: Snippet;
		leadingPane?: Snippet;
		reviewPane?: Snippet;
		topBar?: Snippet;
		body: Snippet;
		preComposer?: Snippet;
		composer?: Snippet;
		footer?: Snippet;
		bottomDrawer?: Snippet;
		trailingPane?: Snippet;
		resizeEdge?: Snippet;
	}

	let {
		widthStyle = "",
		centerColumnStyle = "",
		isFullscreen = false,
		isDraggingEdge = false,
		children: _children,
		onclick,
		onkeydown,
		ondragstart,
		header,
		leadingPane,
		reviewPane,
		topBar,
		body,
		preComposer,
		composer,
		footer,
		bottomDrawer,
		trailingPane,
		resizeEdge,
	}: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex h-full shrink-0 grow-0 min-h-0 bg-card rounded-lg overflow-hidden relative border border-border {isFullscreen
		? ''
		: 'border-r-0'} {isDraggingEdge ? 'select-none' : ''}"
	style={widthStyle}
	{ondragstart}
	{onclick}
	{onkeydown}
>
	<div class="flex flex-col flex-1 min-w-0 min-h-0">
		{@render header()}

		<div class="flex flex-row flex-1 min-h-0 min-w-0 gap-0 overflow-hidden">
			{#if leadingPane}
				{@render leadingPane()}
			{/if}

			{#if reviewPane}
				{@render reviewPane()}
			{/if}

			<div class="flex h-full flex-col min-h-0 min-w-0 overflow-hidden flex-1" style={centerColumnStyle}>
				{#if topBar}
					{@render topBar()}
				{/if}

				<div class="relative flex-1 min-h-0 overflow-hidden flex flex-col">
					{@render body()}
				</div>

				{#if preComposer}
					{@render preComposer()}
				{/if}

				{#if composer}
					{@render composer()}
				{/if}

				{#if footer}
					{@render footer()}
				{/if}

				{#if bottomDrawer}
					{@render bottomDrawer()}
				{/if}
			</div>

			{#if trailingPane}
				{@render trailingPane()}
			{/if}
		</div>

		{#if resizeEdge}
			{@render resizeEdge()}
		{/if}
	</div>
</div>
