<script lang="ts">
	import type { Snippet } from "svelte";

	import AgentPanelShell from "./agent-panel-shell.svelte";

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

<AgentPanelShell
	{widthStyle}
	{centerColumnStyle}
	{isFullscreen}
	{isDraggingEdge}
	{onclick}
	{onkeydown}
	{ondragstart}
>
	{#snippet header()}
		{@render header()}
	{/snippet}

	{#if leadingPane}
		{#snippet leadingPane()}
			{@render leadingPane()}
		{/snippet}
	{/if}

	{#if reviewPane}
		{#snippet reviewPane()}
			{@render reviewPane()}
		{/snippet}
	{/if}

	{#if topBar}
		{#snippet topBar()}
			{@render topBar()}
		{/snippet}
	{/if}

	{#snippet body()}
		{@render body()}
	{/snippet}

	{#if preComposer}
		{#snippet preComposer()}
			{@render preComposer()}
		{/snippet}
	{/if}

	{#if composer}
		{#snippet composer()}
			{@render composer()}
		{/snippet}
	{/if}

	{#if footer}
		{#snippet footer()}
			{@render footer()}
		{/snippet}
	{/if}

	{#if bottomDrawer}
		{#snippet bottomDrawer()}
			{@render bottomDrawer()}
		{/snippet}
	{/if}

	{#if trailingPane}
		{#snippet trailingPane()}
			{@render trailingPane()}
		{/snippet}
	{/if}

	{#if resizeEdge}
		{#snippet resizeEdge()}
			{@render resizeEdge()}
		{/snippet}
	{/if}
</AgentPanelShell>
