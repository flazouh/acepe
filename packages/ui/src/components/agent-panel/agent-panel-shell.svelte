<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		widthStyle?: string;
		centerColumnStyle?: string;
		sessionId?: string | null;
		panelId?: string | null;
		isFullscreen?: boolean;
		isDraggingEdge?: boolean;
		children?: Snippet;
		onclick?: ((event: MouseEvent) => void) | undefined;
		onkeydown?: ((event: KeyboardEvent) => void) | undefined;
		ondragstart?: ((event: DragEvent) => void) | undefined;
		header: Snippet;
		leadingPane?: Snippet;
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
		sessionId = null,
		panelId = null,
		isFullscreen = false,
		isDraggingEdge = false,
		children: _children,
		onclick,
		onkeydown,
		ondragstart,
		header,
		leadingPane,
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
	class="flex h-full shrink-0 grow-0 min-h-0 bg-card/75 rounded-lg overflow-hidden relative border border-border/50 {isDraggingEdge
		? 'select-none'
		: ''}"
	style={widthStyle}
	data-session-id={sessionId ?? undefined}
	data-panel-id={panelId ?? undefined}
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

			<div class="flex h-full flex-col min-h-0 min-w-0 overflow-hidden flex-1" style={centerColumnStyle}>
				{#if topBar}
					{@render topBar()}
				{/if}

				<div class="relative flex-1 min-h-0 overflow-hidden flex flex-col">
					{@render body()}
				</div>

				<!--
					Composer anchor. The pre-composer stack (todo card, queue, error,
					sign-in, scroll controls) floats in a layer anchored to the top edge
					of the composer instead of taking document-flow height, so it overlays
					the bottom of the transcript rather than pushing the chat up. The layer
					is pointer-events-none so untouched transcript beneath the gaps stays
					scrollable; individual cards re-enable pointer events on themselves.
				-->
				<div class="relative shrink-0">
					{#if preComposer}
						<div
							class="pointer-events-none absolute inset-x-0 bottom-full z-20 flex flex-col justify-end"
						>
							{@render preComposer()}
						</div>
					{/if}

					{#if composer}
						{@render composer()}
					{/if}
				</div>

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
