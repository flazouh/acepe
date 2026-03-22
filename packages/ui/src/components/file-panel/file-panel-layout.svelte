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

<!-- Header -->
{#if header}
	{@render header()}
{/if}

<!-- Content -->
<div class="flex-1 min-h-0 overflow-hidden">
	{#if loading}
		{#if loadingSkeleton}
			{@render loadingSkeleton()}
		{:else}
			<div class="flex flex-col gap-2 p-4">
				{#each Array.from({ length: 10 }, (_, i) => i) as index (index)}
					<div class="h-4 w-full rounded bg-muted animate-pulse"></div>
				{/each}
			</div>
		{/if}
	{:else if error}
		{#if errorDisplay}
			{@render errorDisplay()}
		{:else}
			<div class="p-4 text-sm text-destructive">{error}</div>
		{/if}
	{:else if hasContent}
		{@render fileViewer()}
	{:else if emptyDisplay}
		{@render emptyDisplay()}
	{:else}
		<div class="p-4 text-sm text-muted-foreground">No file content</div>
	{/if}
</div>
