<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		loading: boolean;
		error: string | null;
		hasContent: boolean;
		header?: Snippet;
		loadingSkeleton?: Snippet;
		errorDisplay?: Snippet;
		emptyDisplay?: Snippet;
		fileViewer: Snippet;
	}

	let {
		loading,
		error,
		hasContent,
		header,
		loadingSkeleton,
		errorDisplay,
		emptyDisplay,
		fileViewer,
	}: Props = $props();
</script>

{#if header}
	{@render header()}
{/if}

{#if loading}
	{#if loadingSkeleton}
		{@render loadingSkeleton()}
	{/if}
{:else if error}
	{#if errorDisplay}
		{@render errorDisplay()}
	{/if}
{:else if hasContent}
	{@render fileViewer()}
{:else if emptyDisplay}
	{@render emptyDisplay()}
{/if}